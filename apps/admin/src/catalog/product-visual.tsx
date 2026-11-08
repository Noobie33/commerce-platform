import { Icon } from '../icons';
/** Deliberate empty media state until the product-media workflow is available. */
export function ProductVisual({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <div
      className={'product-visual' + (large ? ' product-visual-large' : '')}
      role="img"
      aria-label={'No product photo for ' + name}
    >
      <Icon name="shirt" />
      <span>Photo not added</span>
    </div>
  );
}
