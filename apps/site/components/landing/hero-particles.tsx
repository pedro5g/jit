const particles = [
  { left: "8%", top: "68%", size: 3, delay: "0s", duration: "9s", opacity: 0.4 },
  { left: "22%", top: "82%", size: 2, delay: "2.2s", duration: "11s", opacity: 0.3 },
  { left: "38%", top: "74%", size: 3, delay: "4.6s", duration: "8s", opacity: 0.35 },
  { left: "55%", top: "86%", size: 2, delay: "1.4s", duration: "10s", opacity: 0.45 },
  { left: "68%", top: "70%", size: 4, delay: "3.8s", duration: "12s", opacity: 0.3 },
  { left: "79%", top: "84%", size: 2, delay: "0.8s", duration: "9.5s", opacity: 0.5 },
  { left: "88%", top: "76%", size: 3, delay: "5.4s", duration: "10.5s", opacity: 0.35 },
  { left: "94%", top: "62%", size: 2, delay: "2.9s", duration: "8.5s", opacity: 0.4 },
];

export function HeroParticles() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((particle) => (
        <span
          key={`${particle.left}-${particle.top}`}
          className="pixel-particle"
          style={
            {
              left: particle.left,
              top: particle.top,
              width: particle.size,
              height: particle.size,
              "--particle-delay": particle.delay,
              "--particle-duration": particle.duration,
              "--particle-opacity": particle.opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
