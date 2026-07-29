type TraeLogoProps = {
  className?: string;
};

export default function TraeLogo({ className = 'w-5 h-5' }: TraeLogoProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="bold" fill="currentColor">T</text>
    </svg>
  );
}
