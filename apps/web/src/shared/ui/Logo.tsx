import Image from 'next/image';
import { cx } from './cx';

/** Zelo logo, preserving the original 423×157 proportions. */
export function Logo({ height = 32, className, priority }: { height?: number; className?: string; priority?: boolean }) {
  const width = Math.round((height * 423) / 157);
  return (
    <Image
      src="/brand/zelo-logo-cropped.png"
      alt="Zelo"
      width={width}
      height={height}
      priority={priority}
      className={cx('h-auto shrink-0 object-contain', className)}
      style={{ width, height: 'auto' }}
    />
  );
}
