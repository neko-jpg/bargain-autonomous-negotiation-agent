import { DEFAULT_LOCALE, type Locale } from './config';
import { translate, type TranslationKey } from './dictionary';

/**
 * Error codes returned by the API routes, mapped to dictionary keys so a
 * response is written in the viewer's language instead of the server's.
 */
const API_ERROR_KEYS: Record<string, TranslationKey> = {
  AUTH_REQUIRED: 'api.authRequired',
  AUTH_NOT_CONFIGURED: 'api.authNotConfigured',
  INVALID_ACTOR: 'api.invalidCredentials',
  CROSS_SITE_REQUEST: 'api.crossSiteRequest',
  INVALID_ROLE: 'api.invalidRole',
  INVALID_REQUEST: 'api.invalidRequest',
  LISTING_NOT_FOUND: 'api.listingNotFound',
  PERSISTENCE_NOT_CONFIGURED: 'api.persistenceNotConfigured',
  SESSION_NOT_FOUND: 'api.sessionNotFound',
  SESSION_FORBIDDEN: 'api.sessionForbidden',
  SESSION_FORBIDDEN_OPERATE: 'api.sessionForbiddenOperate',
  SESSION_ID_REQUIRED: 'api.sessionIdRequired',
  OPERATOR_REQUIRED: 'api.operatorOnly',
  INVALID_ENGAGED: 'api.invalidEngaged',
  KILL_SWITCH_LOCKED_BY_ENVIRONMENT: 'api.killSwitchEnv',
  DEMO_DISABLED: 'api.demoDisabled',
  STEP_OUT_OF_BOUNDS: 'api.demoStepOutOfBounds',
  DEMO_FAILED: 'api.demoFailed',
  INVALID_STATUS: 'api.approvalStateInvalid',
  APPROVAL_BODY_INVALID: 'api.approvalBodyInvalid',
  APPROVAL_NOT_FOUND: 'api.approvalNotFound',
  APPROVAL_VERSION_CONFLICT: 'api.approvalVersionConflict',
  APPROVAL_ALREADY_RESOLVED: 'api.approvalAlreadyResolved',
  APPROVAL_FORBIDDEN: 'api.approvalForbidden',
  APPROVAL_EXPIRED: 'api.approvalExpired',
  APPROVAL_SUBJECT_MISSING: 'api.approvalSubjectMissing',
  APPROVAL_SUBJECT_STALE: 'api.approvalSubjectStale',
  APPROVAL_KIND_RETIRED: 'api.approvalKindRetired',
  APPROVAL_FAILED: 'api.approvalFailed',
  CONTRACT_REQUIRES_DEAL: 'api.contractRequiresDeal',
  CONTRACT_FAILED: 'api.contractFailed',
};

export function apiErrorKey(code: string): TranslationKey | undefined {
  return API_ERROR_KEYS[code];
}

/** Localised message for an API error code, with a generic fallback. */
export function apiErrorMessage(
  locale: Locale,
  code: string,
  fallbackKey: TranslationKey = 'api.invalidOperation',
): string {
  const key = apiErrorKey(code) ?? fallbackKey;
  return translate(locale ?? DEFAULT_LOCALE, key);
}
