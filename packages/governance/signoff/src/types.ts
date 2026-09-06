/**
 * Pure types of the signoff record: the five transitions a signature closes,
 * the principal a deployment names, the evidence pointers, and the one
 * `signoff/recorded` event a signed transition leaves in a session log.
 *
 * @module @deepseek-ai/dsh-signoff/types
 */

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One attributed human decision: which transition it closes, who the
     * deployment says signed it, the digest of the artefact signed, and the
     * pointers to what the signer had in view. Appended once per signature,
     * log-only and never part of a model request; a transition may be signed
     * again, and the newest record of a transition is the one consumers read.
     */
    'signoff/recorded': SignoffRecord
  }
}

/**
 * The five transitions that never complete without a signature: freezing a
 * spec, relaxing a security or compliance check, accepting a review, releasing
 * a deliverable, and releasing training data.
 */
export type SignoffTransition =
  | 'spec-freeze'
  | 'relaxation'
  | 'review-acceptance'
  | 'release'
  | 'training-data-release'

/**
 * Who signed, as the deployment's identity provider names them. This package
 * records a principal and never authenticates one, so `id` is only as
 * attributable as the provider that supplied it.
 */
export interface SignoffPrincipal {
  /** Only a person signs a transition; a rule that decides is not a signature. */
  readonly kind: 'human'
  /** Non-empty identity string from the deployment's identity provider. */
  readonly id: string
  /** Human-readable name for a reader of the log; non-empty when present. */
  readonly displayName?: string
}

/** One pointer to something the signer had in view when they signed. */
export interface SignoffEvidence {
  /** Non-empty kind of the referenced material, named by the recording caller. */
  readonly kind: string
  /** Non-empty reference the deployment can resolve: a path, a url, a session id, a digest. */
  readonly ref: string
}

/** Payload of `signoff/recorded`. */
export interface SignoffRecord {
  readonly transition: SignoffTransition
  readonly principal: SignoffPrincipal
  /** Lowercase 64-character SHA-256 hex of the artefact signed. */
  readonly artefactSha256: string
  /** What the signer had in view, bounded by the plugin's configured limits. */
  readonly evidence: readonly SignoffEvidence[]
}
