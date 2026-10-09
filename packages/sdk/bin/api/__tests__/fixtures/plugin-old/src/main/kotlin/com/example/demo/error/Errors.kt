package com.example.demo.error

import com.panomc.platform.model.Error

class EmptyCart : Error(400)

class NotFoundThing(extras: Map<String, Any?> = mapOf()) : Error(404, extras = extras)

class TwoFactorRequired : Error()

class MultiLine : Error(
    403,
    "forbidden"
)

class AlreadyMigrated : Error("ALREADY_MIGRATED", 409)
