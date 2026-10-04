/** Loading state in the Trenchers mark: the grid wakes up cell by cell around the green eye. */
export function Loader({ label, sub }: { label: string; sub?: string }) {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <div className="ld" role="status" aria-live="polite">
      <div className="ld-mark" aria-hidden="true">
        {cells.map((i) => <i key={i} className={`ld-c ld-c${i}${i % 2 === 0 && i !== 4 ? " sq" : ""}`} />)}
      </div>
      <p className="ld-label">{label}</p>
      {sub && <p className="ld-sub">{sub}</p>}
    </div>
  );
}
