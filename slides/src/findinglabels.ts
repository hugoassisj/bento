// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// What each validate() finding code means, in a short sentence a person can
// read — the Check deck panel's words (editor/checkdeck.ts). The finding's own
// message stays the precise, developer-English second line.
//
// English source strings, translated through t() where they are SHOWN (never
// here: a t() at module level freezes the locale at import). Every code
// validate.ts and visualchecks.ts can emit has an entry; a code without one
// falls back to its raw message. scripts/test-slides-check-deck.ts enumerates
// the codes in both files and fails on a missing entry or a missing
// translation, so a new finding cannot reach people untranslated.
//
// No imports, so the node rig can load this file as it is.

export const FINDING_LABELS: Record<string, string> = {
  'broken-link': 'Links to a slide that does not exist',
  'broken-state-parent': 'Variant of a slide that does not exist',
  'chart-key-ignored': 'Chart setting has no effect',
  'chart-label-clipped': 'Chart label is cut off',
  'collab-secrets-present': 'File carries live-session keys',
  'dangling-connector': 'Connector end lost its element',
  'dangling-parent': 'Belongs to a frame that is not there',
  'dash-march-no-dash': 'Dash animation on a solid line does nothing',
  'duplicate-id': 'Two elements share one id',
  'embed-live-no-url': 'Live embed has no web address',
  'embed-missing-view': 'Embed has nothing to show offline',
  'embed-remote-view': 'Embed needs the internet to show',
  'entrance-on-motion-path': 'Entrance fights a motion path',
  'font-not-embedded': 'Font is not embedded',
  'inert-countup': 'Count-up is skipped after the morph',
  'invalid-value': 'A setting has a value it cannot use',
  'low-contrast': 'Text is hard to read against what is behind it',
  'missing-asset': 'Picture or file is missing',
  'morph-key-collision': 'Two elements share one morph name',
  'out-of-canvas': 'Runs off the slide',
  'outside-frame': 'Sticks out of its frame',
  'overridden-enter-fx': 'Entrance never plays after the morph',
  'past-margin': 'Reaches into the side margin',
  'table-overflow': 'Rows run past the box',
  'text-overflow': 'Text does not fit its box',
  'text-overlap': 'Text is drawn over other text',
  'theme-ref-dangling': 'Theme colour link has nothing to colour',
  'theme-ref-malformed': 'Theme colour link cannot be read',
  'theme-ref-stale': 'Colour differs from its theme colour',
  'theme-ref-unknown-slot': 'Linked to an empty theme colour',
  'token-unknown': 'Linked to a token that does not exist',
  'unknown-key': 'Unknown setting is ignored',
  'unknown-type': 'Unknown kind of element, not drawn',
  'unreachable-hidden-slide': 'Hidden slide nothing links to',
}
