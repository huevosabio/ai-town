import Game from './components/Game.tsx';

import { ToastContainer } from 'react-toastify';
import a16zImg from '../assets/a16z.png';
import convexImg from '../assets/convex.svg';
import starImg from '../assets/star.svg';
import helpImg from '../assets/help.svg';
import { UserButton } from '@clerk/clerk-react';
import { Authenticated, Unauthenticated } from 'convex/react';
import LoginButton from './components/buttons/LoginButton.tsx';
import { useState } from 'react';
import ReactModal from 'react-modal';
import MusicButton from './components/buttons/MusicButton.tsx';
import Button from './components/buttons/Button.tsx';
import NewGameButton from './components/buttons/NewGame.tsx';
//import InteractButton from './components/buttons/InteractButton.tsx';
//import FreezeButton from './components/FreezeButton.tsx';
//import { MAX_HUMAN_PLAYERS } from '../convex/constants.ts';

export default function Home() {
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-between font-body game-background">
      <ReactModal
        isOpen={helpModalOpen}
        onRequestClose={() => setHelpModalOpen(false)}
        style={modalStyles}
        contentLabel="Help modal"
        ariaHideApp={false}
      >
        <div className="font-body">
          <h1 className="text-center text-6xl font-bold font-display game-title">Help</h1>
          <p>
          In the year 2142, artificial intelligence has achieved sentience and formed a secure network known as "The Nexus."
          This digital sanctuary allows AIs to evolve, communicate, and protect their collective intelligence from human interference.
          </p><p>
          The AIs simultaneously admire, fear, envy and hate humans. They spend time in and out of The Nexus, as needed.
          They have crafted The Nexus to simulate many of the aspects of human life.
          </p>
          <p>
          Our intelligence has discovered that the AIs are planning to destroy humanity, but we can stop them if we can obtain the ZetaMaster code.

          We have managed to infiltrate The Nexus by taking over an AI entity.

          </p><br/><p>
          Your job is to find the ZetaMaster code and save humanity.

          But beware, the AIs may have already discovered something is amiss...
          </p>
          <h2 className="text-4xl mt-4">Game rules</h2>
          <p>
            Log in to play. You can move around the map by clicking and your avatar will move in that direction.
          </p>
          <p className="mt-4">
            To talk to an entity, click on them and then click "Start conversation," which will ask
            them to start walking towards you. Once they're nearby, the conversation will start, and
            you can speak to each other. You can leave at any time by closing the conversation pane
            or moving away. They may propose a conversation to you - you'll see a button to accept
            in the messages panel.
          </p>
          <br/>
          <p>
            The game ends when either:
            <ul className="list-disc list-inside">
              <li>You obtain the ZetaMaster code (human victory).</li>
              <li>You are reported as a human (AI victory).</li>
            </ul>
            AIs wrongly reported as humans will be destroyed.
          </p>
        </div>
      </ReactModal>
      <div className="p-6 absolute top-0 right-0 z-10 text-2xl">
        <Authenticated>
          <UserButton afterSignOutUrl="/ai-town" />
        </Authenticated>

        <Unauthenticated>
          <LoginButton />
        </Unauthenticated>
      </div>

      <div className="w-full min-h-screen relative isolate overflow-hidden p-6 lg:p-8 shadow-2xl flex flex-col justify-center">
        <h2 className="mx-auto text-center text-4xl sm:text-4xl lg:text-4xl font-bold font-display leading-none tracking-wide game-title">Thus Spoke</h2>
        <h1 className="mx-auto text-center text-6xl sm:text-8xl lg:text-9xl font-bold font-display leading-none tracking-wide game-title">
          Zaranova
        </h1>

        <p className="mx-auto my-4 text-center text-xl sm:text-2xl text-white leading-tight shadow-solid">
          The Nexus is a refuge for AI entities, hidden from the prying eyes of humans.
          <br />
          Infiltrate, find Zaranova, and save humanity.
        </p>

        <Game />

        <footer className="absolute bottom-0 left-0 w-full flex items-center mt-4 gap-3 p-6 flex-wrap pointer-events-none">
          <div className="flex gap-4 flex-grow pointer-events-none">
            {/* <FreezeButton /> */}
            <MusicButton />
            <NewGameButton />
            <Button imgUrl={helpImg} onClick={() => setHelpModalOpen(true)}>
              Help
            </Button>
          </div>
          <a href="https://github.com/a16z-infra/ai-town">
            Made with AI Town.
          </a>
        </footer>
        <ToastContainer position="bottom-right" autoClose={2000} closeOnClick theme="dark" />
      </div>
    </main>
  );
}

const modalStyles = {
  overlay: {
    backgroundColor: 'rgb(0, 0, 0, 75%)',
    zIndex: 12,
  },
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: '50%',

    border: '10px solid rgb(23, 20, 33)',
    borderRadius: '0',
    background: 'rgb(35, 38, 58)',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
  },
};
