import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { kindWords, type BlockLibraryCount } from './count'

const n = (v: number) => new Intl.NumberFormat('en-GB').format(v)

/**
 * DES-ENGINE-004: the block library's count on the Admin's Inspiration
 * inbox page, in plain words: how many blocks GROS can build Scratch
 * emails from, toward 2,000, by kind and by where they came from, with
 * how many sections were folded into a block that already had their
 * layout. It says how a block is counted, since BLK-SCALE-001 is open.
 */
export function BlockLibraryCard({
  count
}: {
  count: BlockLibraryCount | null
}) {
  const title = 'Block library'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {!count ? (
          <p className="type-body text-[var(--stone)]">
            The block count could not be read. Reload the page to try again.
          </p>
        ) : (
          <>
            <p className="type-number-lg">
              {n(count.counted)} of {n(count.target)}
            </p>
            <p className="type-body">
              {n(count.seeds)} coded seed blocks and {n(count.inbox)} blocks
              from the Inspiration inbox. {n(count.sections)} sections were
              read; {n(count.merged)} of them had a layout the library already
              had, so they count as uses of that block, not as new blocks.{' '}
              {n(count.reused)} layouts are used more than once and{' '}
              {n(count.twoBrands)} by two brands or more.
            </p>
            <p className="type-body text-[var(--stone)]">
              How a block is counted until you decide (BLK-SCALE-001): one block
              is one distinct layout. Sections with the same kind and the same
              parts in the same places are one block, whatever their words,
              colours or pictures. Only blocks that draw back like their source
              count. {n(count.failed)} did not and stay out of Scratch.
              Workspaces&rsquo; private blocks, from their own emails:{' '}
              {n(count.private)} (never shared, not in the count).
            </p>
            {count.byKind.length ? (
              <RowList label="Blocks by kind">
                {count.byKind.map((k) => (
                  <ListRow
                    key={k.kind}
                    thumbnail={null}
                    title={kindWords[k.kind]}
                    details={[
                      `${n(k.inbox)} from the inbox`,
                      `${n(k.private)} private`,
                      `${n(k.uses)} sections`
                    ]}
                    end={null}
                  />
                ))}
              </RowList>
            ) : null}
          </>
        )}
      </div>
    </Card>
  )
}
