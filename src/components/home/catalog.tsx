import { ToolCard } from '@/components/marketplace/cards';
import { Icon } from '@/components/ui/icon';
import { categories, isReady, listedTools } from '@/lib/catalog';
import { Pinnable } from './pin';

/**
 * Every open tool, by what it helps with: the full catalog on /tools/all. Each card can be kept
 * handy, here without a hover (on a phone this is where pinning happens besides the tool itself).
 */
export function CatalogShelves() {
  const shelves = categories
    .map((category) => ({
      category,
      tools: listedTools.filter((tool) => tool.category === category.id && isReady(tool)),
    }))
    .filter((shelf) => shelf.tools.length > 0);
  return (
    <div
      id="all"
      className="mx-auto grid w-full max-w-[1320px] gap-12 px-4 pt-8 sm:gap-16 sm:px-6 sm:pt-12 lg:px-8"
    >
      {shelves.map(({ category, tools }) => (
        <section key={category.id} aria-labelledby={`shelf-${category.id}`}>
          <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
            <div className="min-w-0">
              <h2
                id={`shelf-${category.id}`}
                className="flex items-center gap-2.5 t-h3 !text-[22px] sm:!text-[28px]"
              >
                <Icon name={category.icon} size={20} className="text-muted" />
                {category.name}
              </h2>
              <p className="mt-1 text-[14px] text-muted">{category.line}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-8 lg:grid-cols-4">
            {tools.map((tool) => (
              <Pinnable key={tool.id} tool={tool} always>
                <ToolCard tool={tool} />
              </Pinnable>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
