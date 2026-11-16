/**
 * What the PR page shows for each view of a layer (`PullViewScope`): its title in the bar, where its diff runs from,
 * where a verdict goes, its words when it changes no files, and the layers it shows (the ones it marks looked at).
 */
import { inboxPullAncestors, inboxPullIsOpen, inboxPullLabel, type InboxPull, type InboxPullDiffScope, type InboxPullStack } from '@plannotator/core/inbox-types';
import { rangeName, rangeOf } from '../prs/stackRange';
import { scopeParts, type PullViewScope } from './viewScope';

export interface ScopeOnPage {
  scope: InboxPullDiffScope;
  from?: string;
  /** The bar's title for a compare of layers; null: the layer's own title. */
  title: string | null;
  /** "Layers 6–9" for a range. */
  rangeName: string | null;
  /** The ref the diff runs from, as the diff's answer names it. */
  base: string | undefined;
  /** A verdict goes to the stack's review thread, and line comments map to no one PR's lines. */
  whole: boolean;
  /** The note for a diff of no files. */
  empty: string;
  /** The open layers its diff shows. */
  covers: InboxPull[];
}

export function scopeOnPage(stack: Pick<InboxPullStack, 'layers' | 'parents' | 'open_base'>, layer: InboxPull, view: PullViewScope, noun: string): ScopeOnPage {
  const { scope, from } = scopeParts(view);
  const label = inboxPullLabel(layer);
  const range = scope === 'range' && from ? rangeOf(stack, from, layer.key) : null;
  const name = range ? rangeName(stack, range) : null;
  const under = inboxPullAncestors(stack, layer.key).filter(inboxPullIsOpen).reverse();
  return {
    scope,
    ...(from ? { from } : {}),
    title: scope === 'stack' ? `截止 ${label} 的整个堆叠` : name ? `${name}，作为一个 Diff` : null,
    rangeName: name,
    base: scope === 'stack' ? stack.open_base : scope === 'range' ? range?.first.base : scope === 'since' ? from : layer.base,
    whole: scope === 'stack' || scope === 'range',
    empty: scope === 'stack' ? `截止 ${label} 的堆叠没有改动任何文件。` : name ? `${name} 没有改动任何文件。` : scope === 'since' ? '自你上次查看以来，没有文件发生变化。' : `这个 ${noun} 没有改动任何文件。`,
    covers: scope === 'stack' ? [...under, layer] : range ? range.layers.filter(inboxPullIsOpen) : [layer],
  };
}
