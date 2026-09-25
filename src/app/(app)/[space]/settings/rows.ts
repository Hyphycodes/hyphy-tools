import { planFor, plans } from '@/lib/platform/plans';
import { toolName, tools } from '@/lib/platform/tools';
import type { Space } from '@/lib/platform/types';
import { workProfile } from '@/lib/platform/work';
import type { ToggleRow } from './module-toggles';

/** The tools a Space can switch on or off, for Settings and a new business's setup. */
export function toggleRowsFor(space: Space): ToggleRow[] {
  const plan = plans[space.plan];
  const personal = space.kind === 'personal';
  return tools
    .filter((tool) => tool.module && tool.status !== 'soon' && tool.spaceKinds.includes(space.kind))
    .map((tool) => {
      const inPlan = plan.includes.includes(tool.module!);
      return {
        module: tool.module!,
        name: toolName(tool, space),
        // Projects are called what this Space calls them (Jobs, Events, Properties).
        tagline:
          tool.module === 'projects'
            ? `Every ${workProfile(space).singular.toLowerCase()} in one place.`
            : tool.tagline,
        color: tool.color,
        ink: tool.ink,
        icon: tool.icon,
        locked: inPlan
          ? undefined
          : `Included with ${planFor(tool.module!, space.kind)?.name ?? 'a higher plan'}`,
        required: tool.module === 'files' || (!personal && tool.module === 'people'),
      };
    });
}
