package com.five.anarutas.driver

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.google.android.libraries.navigation.NavigationApi

class DriverApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.NAVIGATION_API_KEY.isNotBlank())
            NavigationApi.setApiKey(BuildConfig.NAVIGATION_API_KEY)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel("routes", "Rutas", NotificationManager.IMPORTANCE_HIGH)
            )
        }
    }
}
