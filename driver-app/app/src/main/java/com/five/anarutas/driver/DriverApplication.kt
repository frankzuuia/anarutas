package com.five.anarutas.driver

import android.app.Application
import com.google.android.libraries.navigation.NavigationApi

class DriverApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.NAVIGATION_API_KEY.isNotBlank())
            NavigationApi.setApiKey(BuildConfig.NAVIGATION_API_KEY)
    }
}
