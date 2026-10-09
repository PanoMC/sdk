package com.example.demo.error

import com.panomc.platform.model.Error

class EmptyCart : Error("EMPTY_CART", 400)

class NotFoundThing(extras: Map<String, Any?> = mapOf()) : Error("NOT_FOUND_THING", 404, extras = extras)

class TwoFactorRequired : Error("TWO_FACTOR_REQUIRED")

class MultiLine : Error("MULTI_LINE",
    403,
    "forbidden"
)

class AlreadyMigrated : Error("ALREADY_MIGRATED", 409)
