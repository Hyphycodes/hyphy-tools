import { TOOL_IDS } from './ids';
import { categorySchema, familySchema, toolSchema, type Tool } from './schema';
import { categories, families } from './taxonomy';

/**
 * Checks the registry against its schema and against itself: every id registered once, every
 * link between tools real, privacy facts that agree with each other, editorial flags only on
 * tools people can open. Returns the problems in plain words; `npm test` expects none.
 */
export function validateCatalog(list: readonly Tool[]): string[] {
  const problems: string[] = [];
  const say = (tool: Pick<Tool, 'id'> | undefined, message: string) =>
    problems.push(tool ? `${tool.id}: ${message}` : message);

  for (const family of families) {
    const parsed = familySchema.safeParse(family);
    if (!parsed.success) say(undefined, `family ${family.id}: ${parsed.error.message}`);
  }
  for (const category of categories) {
    const parsed = categorySchema.safeParse(category);
    if (!parsed.success) say(undefined, `category ${category.id}: ${parsed.error.message}`);
  }

  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const tool of list) {
    const parsed = toolSchema.safeParse(tool);
    if (!parsed.success) say(tool, parsed.error.issues.map((issue) => issue.message).join('; '));
    if (ids.has(tool.id)) say(tool, 'registered twice');
    if (slugs.has(tool.slug)) say(tool, `slug “${tool.slug}” is taken`);
    ids.add(tool.id);
    slugs.add(tool.slug);

    for (const id of tool.related) {
      const other = list.find((item) => item.id === id);
      if (id === tool.id) say(tool, 'is related to itself');
      else if (!other) say(tool, `related tool “${id}” isn’t registered`);
      else if (other.visibility === 'hidden') say(tool, `related tool “${id}” is hidden`);
    }
    if (new Set(tool.related).size !== tool.related.length) say(tool, 'repeats a related tool');

    const { processing, storage } = tool.privacy;
    if (storage.includes('none') && storage.length > 1)
      say(tool, 'says it keeps nothing and also that it keeps something');
    if (storage.includes('account') && tool.account === 'none')
      say(tool, 'keeps data with an account but needs no account');
    if (processing === 'server' && !storage.includes('account'))
      say(tool, 'works on a server, so it must say what the account keeps');

    if (tool.status === 'soon' && (tool.featured || tool.pick))
      say(tool, 'is featured before anyone can use it');
    if (tool.status !== 'soon' && tool.steps.length === 0) say(tool, 'needs its steps');
    if (tool.access === 'freemium' && !tool.later.some((item) => item.pro))
      say(tool, 'is freemium but names no paid extra');
    if (tool.access === 'free' && tool.later.some((item) => item.pro))
      say(tool, 'plans a paid extra, so it is freemium');
    if (tool.keywords.some((keyword) => keyword !== keyword.toLowerCase()))
      say(tool, 'keywords are written in lowercase');
  }

  for (const id of TOOL_IDS)
    if (!list.some((tool) => tool.id === id)) say(undefined, `“${id}” has no entry`);

  return problems;
}
