export default function MiniTitle() {
  // check if we should be in a lobby, or if we should be in a game
  // if either is true, return the compressed title, else return the full title

  return (
    <>
      <div className="p-3 absolute top-0 left-0 z-10 text-md">
        <h1 className="mx-auto text-center text-md font-bold font-display leading-none tracking-wide game-title">
          Zaranova
        </h1>
      </div>
    </>
  );
}