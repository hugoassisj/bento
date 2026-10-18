// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

/**
 * The session around the ROUTINE key (identity-design §2e (B)): past the idle
 * or the overall timeout the agent refuses even routine signatures — `reauth`
 * in the identity contract — until the person authenticates again.
 *
 * Two layers, each enforcing a different bound:
 *   - the Keystore's validity window on the key (AgentKeys) is the HARDWARE
 *     floor: no device authentication in OVERALL_SECONDS and the key will not
 *     sign. A lock-screen unlock reopens it, so it means "since the device was
 *     last unlocked", never "since Bento was last used";
 *   - this gate is "since Bento was last used": idle since the last routine
 *     signature, overall since the person last authenticated TO BENTO.
 *
 * Pure and clock-injected so the rules are testable on the JVM. Defaults are
 * the AAL2 SHOULDs; an organisation may tighten them (AAL3: 15 min / 12 h),
 * never loosen them.
 */
class RoutineGate(
    private val idleMs: Long = IDLE_SECONDS * 1000L,
    private val overallMs: Long = OVERALL_SECONDS * 1000L,
) {
    init { require(idleMs in 1..IDLE_SECONDS * 1000L && overallMs in 1..OVERALL_SECONDS * 1000L) { "timeouts may only tighten" } }

    private var authenticatedAt = -1L
    private var lastUse = -1L

    /** The person just authenticated to Bento (a BiometricPrompt that succeeded). */
    fun authenticated(now: Long) { authenticatedAt = now; lastUse = now }

    /** May the routine key sign now? A yes counts as use and refreshes the idle clock. */
    fun allow(now: Long): Boolean {
        if (authenticatedAt < 0) return false
        if (now < lastUse || now < authenticatedAt) { lock(); return false }   // clock went backwards: fail closed
        if (now - lastUse >= idleMs || now - authenticatedAt >= overallMs) { lock(); return false }
        lastUse = now
        return true
    }

    fun lock() { authenticatedAt = -1L; lastUse = -1L }

    companion object {
        const val IDLE_SECONDS = 60 * 60
        const val OVERALL_SECONDS = 24 * 60 * 60
    }
}
