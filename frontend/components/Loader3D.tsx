/** A small spinning 3D cube (pure CSS), shown while something takes a moment. Respects "reduce motion". */
export default function Loader3D({ label = "Loading" }: { label?: string }) {
  return (
    <div className="cube-scene" role="img" aria-label={label}>
      <div className="cube">
        {["front", "back", "right", "left", "top", "bottom"].map((face) => <span key={face} className={`cube-face cube-${face}`} />)}
      </div>
    </div>
  );
}
