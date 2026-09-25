package com.five.anarutas.driver

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class SavedAccess(
    val phone: String,
    val deviceId: String,
    val token: String,
)

/** Session bearer is encrypted with a non-exportable Android Keystore key. */
class DeviceCredentials(context: Context) {
    private val preferences = context.getSharedPreferences("driver_access_v1", Context.MODE_PRIVATE)
    private val navigationProgress = NavigationProgressStore(context)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val signingAlias = "ana_rutas_driver_signing_v1"
    private val tokenAlias = "ana_rutas_driver_token_v1"

    private fun tokenKey(): SecretKey {
        val existing = keyStore.getKey(tokenAlias, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                tokenAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encryptedToken(token: String): Pair<String, String> {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, tokenKey())
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) to
            Base64.encodeToString(cipher.doFinal(token.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decryptedToken(): String {
        val iv = preferences.getString("token_iv", null) ?: return ""
        val ciphertext = preferences.getString("token_ciphertext", null) ?: return ""
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                tokenKey(),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
            )
            String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) {
            clearToken()
            ""
        }
    }

    fun load(): SavedAccess = SavedAccess(
        phone = preferences.getString("phone", "") ?: "",
        deviceId = preferences.getString("device_id", "") ?: "",
        token = decryptedToken(),
    )

    fun save(phone: String, deviceId: String, token: String) {
        val (iv, ciphertext) = encryptedToken(token)
        preferences.edit()
            .remove("server")
            .putString("phone", phone)
            .putString("device_id", deviceId)
            .putString("token_iv", iv)
            .putString("token_ciphertext", ciphertext)
            .apply()
    }

    fun clearToken() {
        clearPendingStopCommand()
        preferences.edit().remove("token_iv").remove("token_ciphertext").apply()
        navigationProgress.clearAll()
    }

    fun clearDevice() {
        clearPendingStopCommand()
        preferences.edit().remove("device_id").remove("token_iv")
            .remove("token_ciphertext").apply()
        navigationProgress.clearAll()
        if (keyStore.containsAlias(signingAlias)) keyStore.deleteEntry(signingAlias)
    }

    fun publicKeyPem(): String {
        val key = keyStore.getCertificate(signingAlias)?.publicKey?.encoded ?: run {
            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            generator.initialize(
                KeyGenParameterSpec.Builder(
                    signingAlias,
                    KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
                )
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build(),
            )
            generator.generateKeyPair().public.encoded
        }
        val lines = Base64.encodeToString(key, Base64.NO_WRAP).chunked(64).joinToString("\n")
        return "-----BEGIN PUBLIC KEY-----\n$lines\n-----END PUBLIC KEY-----\n"
    }

    internal fun savePendingStopCommand(planId: String, value: String) {
        val (iv, ciphertext) = encryptedToken(value)
        check(preferences.edit().putString("stop:$planId:iv", iv).putString("stop:$planId:ciphertext", ciphertext).commit())
    }

    internal fun readPendingStopCommand(planId: String): String? {
        val iv = preferences.getString("stop:$planId:iv", null) ?: return null
        val ciphertext = preferences.getString("stop:$planId:ciphertext", null) ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, tokenKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) { clearPendingStopCommand(planId); null }
    }

    internal fun clearPendingStopCommand(planId: String? = null) {
        val editor = preferences.edit()
        if (planId != null) editor.remove("stop:$planId:iv").remove("stop:$planId:ciphertext")
        else preferences.all.keys.filter { it.startsWith("stop:") }.forEach(editor::remove)
        editor.apply()
    }

    fun signChallenge(challengeId: String, nonce: String): String {
        val key = keyStore.getKey(signingAlias, null)
            ?: throw IllegalStateException("DEVICE_KEY_MISSING")
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(key as java.security.PrivateKey)
        signature.update("ana-rutas-mobile-login-v1:$challengeId:$nonce".toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }
}
