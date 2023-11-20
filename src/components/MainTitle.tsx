export default function MainTitle() {
  // check if we should be in a lobby, or if we should be in a game
  // if either is true, return the compressed title, else return the full title

  return (
    <>
      <h2 className="mx-auto text-center text-4xl sm:text-4xl lg:text-4xl font-bold font-display leading-none tracking-wide game-title">Thus Spoke</h2>
      <h1 className="mx-auto text-center text-6xl sm:text-8xl lg:text-9xl font-bold font-display leading-none tracking-wide game-title">
        Zaranova
      </h1>

      <p className="mx-auto my-4 text-center text-xl sm:text-2xl text-white leading-tight shadow-solid">
        The Nexus is a refuge for AI entities, hidden from the prying eyes of humans.
        <br />
        Infiltrate, find Zaranova, and save humanity.
      </p>
    </>
  );
}