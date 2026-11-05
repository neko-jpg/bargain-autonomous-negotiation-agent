import type { TranslationKey } from './dictionary';

/**
 * Maps domain enum values to dictionary keys.
 *
 * Kept separate from the dictionaries so components can translate catalog
 * categories and negotiation enums without importing catalog internals.
 */
const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  all: 'category.all',
  games: 'category.games',
  electronics: 'category.electronics',
  fashion: 'category.fashion',
  sports: 'category.sports',
  media: 'category.media',
  living: 'category.living',
  kitchen: 'category.kitchen',
  kids: 'category.kids',
  other: 'category.other',
};

const CONDITION_LABEL_KEYS: Record<string, TranslationKey> = {
  new: 'enum.condition.new',
  like_new: 'enum.condition.like_new',
  good: 'enum.condition.good',
  fair: 'enum.condition.fair',
};

const ACTION_LABEL_KEYS: Record<string, TranslationKey> = {
  make_offer: 'enum.action.make_offer',
  counter_offer: 'enum.action.counter_offer',
  accept_offer: 'enum.action.accept_offer',
  reject_offer: 'enum.action.reject_offer',
  wait: 'enum.action.wait',
  ask_user: 'enum.action.ask_user',
};

const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  initializing: 'enum.status.initializing',
  active: 'enum.status.active',
  waiting: 'enum.status.waiting',
  awaiting_commit: 'enum.status.awaiting_commit',
  deal: 'enum.status.deal',
  rejected: 'enum.status.rejected',
  paused_for_human: 'enum.status.paused_for_human',
};

function lookup(map: Record<string, TranslationKey>, value: string | undefined): TranslationKey | undefined {
  if (!value) return undefined;
  return map[value];
}

export function categoryLabelKey(categoryId: string | undefined): TranslationKey | undefined {
  return lookup(CATEGORY_LABEL_KEYS, categoryId);
}

export function conditionLabelKey(condition: string | undefined): TranslationKey | undefined {
  return lookup(CONDITION_LABEL_KEYS, condition);
}

export function actionLabelKey(action: string | undefined): TranslationKey | undefined {
  return lookup(ACTION_LABEL_KEYS, action);
}

export function statusLabelKey(status: string | undefined): TranslationKey | undefined {
  return lookup(STATUS_LABEL_KEYS, status);
}
