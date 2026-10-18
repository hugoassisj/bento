// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// What the crash-recovery banner says, and the one-time "recovery is off"
// notice. Both are maintainer rulings shared with slides and type
// (2026-10-15); slides' editor.ts (showRecoveryBanner, noticeRecoveryOff) is
// the reference, and the strings are its strings with "deck" read as "space".
//
// THE OLDER-COPY WARNING. The kernel says whether a recovery snapshot looks
// OLDER than the file now open (autosave.ts recoveryLooksOlder: both times
// known and the snapshot's the earlier; unknown either side is false). It is a
// SIGNAL, never a reason to hide the offer: the two times come from different
// clocks, so a false "older" must only change the words and the default. So
// the banner still offers the snapshot ("Restore anyway"), "Keep the file" is
// the primary button and takes focus, and keeping the file deletes NOTHING —
// a clock-skewed "older" must never cost work. With no signal the banner is the
// plain one, with Restore its default (styled, not focused), and claims nothing about "newer" or
// "safe".
//
// THE RECOVERY-OFF NOTICE. Under a host with a per-document store (bento/home),
// the kernel fires onRecoveryOff once per document when the host refuses the
// recovery copy (too large). From then on there is no crash backstop, and the
// author is told so once per space per page load, where the save status shows.
// Never for an encrypted space: those are never snapshotted, so there was no
// backstop to lose.

import { onRecoveryOff, recoveryLooksOlder, type Snapshot } from '../../kernel/src/autosave.ts'
import { t } from './i18n'

export type RecoveryAction = 'restore' | 'discard' | 'keep'

export interface RecoveryButton {
  label: string
  action: RecoveryAction
  /** the default: styled primary */
  primary?: boolean
  /** takes focus when the banner appears — only where slides focuses */
  focus?: boolean
}

export interface RecoveryBanner {
  older: boolean
  text: string
  buttons: RecoveryButton[]
}

/** The banner for a snapshot that has already passed the gate
 *  (restoregate.ts recoveryOffered). */
export function recoveryBanner(snap: Snapshot, doc: { modified?: string | number }): RecoveryBanner {
  const older = recoveryLooksOlder(snap, doc)
  if (older) {
    return {
      older,
      text: t('This recovered copy looks older than the file you opened. Keep the file unless you know it’s newer.'),
      buttons: [
        { label: t('Keep the file'), action: 'keep', primary: true, focus: true },
        { label: t('Restore anyway'), action: 'restore' },
      ],
    }
  }
  // The plain banner's default is Restore, as slides' is (lead ruling,
  // 2026-10-16): a primary button is the expected recovery action, not a claim
  // that the copy is newer or safe — the text still claims neither. Like
  // slides, it is styled as the default but NOT focused.
  return {
    older,
    text: t('Unsaved changes from a previous session were found.'),
    buttons: [
      { label: t('Restore'), action: 'restore', primary: true },
      { label: t('Discard'), action: 'discard' },
    ],
  }
}

export interface RecoveryOffWiring {
  /** the space open in this page, read when the kernel fires */
  docId: () => string
  /** is this space encrypted now? */
  encrypted: () => boolean
  /** show the message where the save status shows */
  say: (msg: string) => void
  /** the kernel's subscription; a rig may pass its own to fire twice */
  subscribe?: typeof onRecoveryOff
}

/** Listen for the kernel's recovery-off signal and say so once per space.
 *  Returns the unsubscribe. */
export function wireRecoveryOff(w: RecoveryOffWiring): () => void {
  const said = new Set<string>()
  return (w.subscribe ?? onRecoveryOff)((docId) => {
    if (docId !== w.docId() || w.encrypted() || said.has(docId)) return
    said.add(docId)
    w.say(t('Crash recovery is off for this space — it’s too large to keep a backup copy. Save often.'))
  })
}
