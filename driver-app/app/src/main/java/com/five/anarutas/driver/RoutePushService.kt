package com.five.anarutas.driver

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch

internal object RoutePushEvents {
    val refresh = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
}

internal data class RoutePushNotice(val title: String, val body: String)

internal fun routePushNotice(event: String?): RoutePushNotice? = when (event) {
    "route_published" -> RoutePushNotice("Nueva ruta disponible", "Tu ruta ya está lista. Abre Ana Rutas para verla.")
    "route_withdrawn" -> RoutePushNotice("Ruta retirada", "Administración retiró tu ruta. Abre Ana Rutas para ver tu jornada.")
    else -> null
}

internal object RoutePushRegistration {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun register() {
        FirebaseMessaging.getInstance().register()
    }

    fun upload(context: Context, fid: String) {
        scope.launch {
            runCatching {
                val credentials = DeviceCredentials(context.applicationContext).load()
                if (credentials.token.isNotBlank())
                    DriverApi(BuildConfig.SERVER_URL).registerPush(credentials.token, fid)
            }
        }
    }
}

class RoutePushService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) {
        RoutePushRegistration.upload(applicationContext, installationId)
    }

    override fun onNewToken(token: String) {
        // A legacy token refresh still forces FID delivery through onRegistered().
        RoutePushRegistration.register()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val notice = routePushNotice(message.data["event"]) ?: return
        RoutePushEvents.refresh.tryEmit(Unit)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, "routes")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(notice.title)
            .setContentText(notice.body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        NotificationManagerCompat.from(this).notify(message.messageId?.hashCode() ?: notice.title.hashCode(), notification)
    }
}
