import { z } from 'zod';
import type { IconName } from '@/components/ui/icon';
import type { ModuleId } from '@/lib/platform/types';
import { CATEGORY_IDS, FAMILY_IDS, TOOL_IDS } from './ids';

/**
 * The shape of every public tool, defined once. Types are derived from these schemas, and
 * `validateCatalog()` checks the whole catalog against them (and against itself) in the tests.
 * Import types from here with `import type`; runtime lists live in `ids.ts`, so the marketplace
 * never ships the validator to the browser.
 */

export const toolId = z.enum(TOOL_IDS);
export type ToolId = z.infer<typeof toolId>;

export const categoryId = z.enum(CATEGORY_IDS);
export type CategoryId = z.infer<typeof categoryId>;

export const familyId = z.enum(FAMILY_IDS);
export type FamilyId = z.infer<typeof familyId>;

/** Only three statuses ever reach the surface: Available, Beta and Coming soon. */
export const toolStatus = z.enum(['available', 'beta', 'soon']);
export type ToolStatus = z.infer<typeof toolStatus>;

/**
 * `public` tools are everywhere; `unlisted` ones open from a direct link but stay out of the
 * marketplace and search; `hidden` ones have no page at all yet.
 */
export const visibility = z.enum(['public', 'unlisted', 'hidden']);

/**
 * Where a tool's work happens and where anything is kept. Privacy copy is generated from these
 * facts, so the words can't promise more than the architecture does.
 *
 * - processing `device`: the work runs in the browser; files are never uploaded.
 * - storage `browser`: kept in this browser's storage, on this device only.
 * - storage `link`: shared through the link itself (after the #, which browsers never send).
 * - storage `account`: kept with a Hyphy account (arrives with accounts).
 */
export const privacySchema = z.object({
  processing: z.enum(['device', 'server']),
  storage: z.array(z.enum(['none', 'browser', 'link', 'account'])).min(1),
  /** One extra plain sentence when the facts need context. */
  note: z.string().optional(),
});
export type ToolPrivacy = z.infer<typeof privacySchema>;

/** Something planned, said plainly, and whether it's expected to be part of Pro. */
export const laterSchema = z.object({ label: z.string().min(3), pro: z.boolean() });

export const toolSchema = z.object({
  id: toolId,
  /** The address: /tools/{slug}. */
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(2),
  /** What it is, in the words people search with: "Check splitter". */
  kind: z.string().min(3),
  /** The one-line promise. */
  tagline: z.string().min(8),
  description: z.string().min(20),
  category: categoryId,
  family: familyId.optional(),
  /** A small seasonal release. */
  drop: z.object({ season: z.string(), line: z.string() }).optional(),
  status: toolStatus,
  visibility,
  /** `free` today; `freemium` when something optional will cost money later; `pro` when the tool itself will. */
  access: z.enum(['free', 'freemium', 'pro']),
  /** Whether using it needs an account. */
  account: z.enum(['none', 'optional', 'required']),
  privacy: privacySchema,
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  /** Text on the accent: dark for bright colors. */
  accentInk: z.enum(['dark', 'light']),
  icon: z.custom<IconName>((value) => typeof value === 'string'),
  /** Human search language: phrases people type, not Hyphy's names. */
  keywords: z.array(z.string().min(2)).min(3),
  /** Other products and names people know this by ("linktree"). */
  aliases: z.array(z.string().min(2)),
  related: z.array(toolId).max(4),
  /** Editorial, never usage data. */
  featured: z.boolean().optional(),
  pick: z.boolean().optional(),
  /** New in the latest release. */
  fresh: z.boolean().optional(),
  /** Lower comes first. */
  priority: z.number().int(),
  /** How it works, in at most four steps. */
  steps: z.array(z.string()).max(4),
  /** Honest limits of the current version. */
  limits: z.array(z.string()),
  later: z.array(laterSchema),
  /** The same tool inside Hyphy Spaces (when accounts are on). */
  spaces: z.custom<ModuleId>((value) => typeof value === 'string').optional(),
});
export type Tool = z.infer<typeof toolSchema>;

export const familySchema = z.object({
  id: familyId,
  name: z.string(),
  /** What the family is for, in one line. */
  line: z.string(),
  /** A short paragraph for its stage on the marketplace. */
  story: z.string(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type Family = z.infer<typeof familySchema>;

export const categorySchema = z.object({
  id: categoryId,
  name: z.string(),
  line: z.string(),
  icon: z.custom<IconName>((value) => typeof value === 'string'),
});
export type Category = z.infer<typeof categorySchema>;
