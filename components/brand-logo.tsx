import Image from "next/image";

export function BrandLogo() {
  return (
    <span aria-hidden="true" className="brand-logo">
      <Image
        alt=""
        height={64}
        priority
        src="/brand/drcc-logo.png"
        width={64}
      />
    </span>
  );
}
