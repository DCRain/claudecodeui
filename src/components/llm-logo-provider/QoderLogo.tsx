type QoderLogoProps = {
  className?: string;
};

export default function QoderLogo({ className = 'w-5 h-5' }: QoderLogoProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="bold" fill="currentColor">Q</text>
    </svg>
  );
}
