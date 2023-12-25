import Game from './components/Game.tsx';

import { ToastContainer } from 'react-toastify';
import a16zImg from '../assets/a16z.png';
import convexImg from '../assets/convex.svg';
import starImg from '../assets/star.svg';
import helpImg from '../assets/help.svg';
import burgerImg from '../assets/hamburger.svg';
import { UserButton } from '@clerk/clerk-react';
import { Authenticated, Unauthenticated, useQuery, useMutation} from 'convex/react';
import { api } from '../convex/_generated/api';
import LoginButton from './components/buttons/LoginButton.tsx';
import React, { useState, useEffect, ComponentType, ReactElement } from 'react';
import ReactModal from 'react-modal';
import MusicButton from './components/buttons/MusicButton.tsx';
import Button from './components/buttons/Button.tsx';
import NewGameButton from './components/buttons/NewGame.tsx';
import Lobby from './components/Lobby.tsx';
import NewZaraGameButton from './components/buttons/NewZaraGameButton.tsx';
import MiniTitle from './components/MiniTitle.tsx';
import MainTitle from './components/MainTitle.tsx';
import {notificationToast} from './toasts.ts';
//import InteractButton from './components/buttons/InteractButton.tsx';
//import FreezeButton from './components/FreezeButton.tsx';
//import { MAX_HUMAN_PLAYERS } from '../convex/constants.ts';

export default function Home() {
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeGame, setActiveGame] = useState(false);
  const [activeLobby, setActiveLobby] = useState(false);
  const [mainComponent, setMainComponent] = useState<React.ReactElement | null>(null);
  const [titleComponent, setTitleComponent] = useState<React.ReactElement | null>(<MainTitle />);

  
  useEffect(() => {
    if (activeGame) {
      setMainComponent(<Game setActiveGame={setActiveGame} />);
      setTitleComponent(<MiniTitle />);
    } else if (activeLobby) {
      setMainComponent(<Lobby setActiveLobby={setActiveLobby} />);
      setTitleComponent(<MiniTitle />);
    } else {
      setMainComponent(null);
      setTitleComponent(<MainTitle />);
    }
  }, [activeGame, activeLobby]);

  const notifications = useQuery(api.zaraInit.getNotifications, {});
  const markNotificationsAsRead = useMutation(api.zaraInit.markNotificationsAsRead);

  if (notifications) {
    for (const notification of notifications) {
      // toast
      notificationToast(notification.message);
    }
    // clear notifications
    markNotificationsAsRead({
      notificationIds: notifications.map((n) => n._id),
    });
  }
  

  
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-between font-body game-background">
      <ReactModal
        isOpen={helpModalOpen}
        onRequestClose={() => setHelpModalOpen(false)}
        style={modalStyles}
        contentLabel="Help modal"
        ariaHideApp={false}
      >
        <div className="font-body text-xs sm:text-sm md:text-md">
        <b>Update: </b> I have swapped the model to GPT-3.5 while I secure more credits/funding for GPT-4 or a worthwhile replacement.
        Sadly, GPT-3.5 is not as good and the game is actually easier. Thanks for understanding!
        <h1 className="text-center text-xl sm:text-2xl md:text-4xl font-bold font-display game-title">Background</h1>
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
          <h1 className="text-center text-xl sm:text-2xl md:text-4xl font-bold font-display game-title">Game rules</h1>
          
          <br/>
          <p>
            Log in to play. You can move around the map by clicking and your avatar will move in that direction.
          </p>
          <p>At least one of the characters has the ZetaMaster code, but you don't know which. It is your job to find it and obtain it.</p>
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
          </p>
            <ul className="list-disc list-inside">
              <li>You obtain the ZetaMaster code (human victory).</li>
              <li>You are reported as a human (AI victory).</li>
            </ul>
          <p>
            AIs wrongly reported as humans will be destroyed.
          </p>

          <br/>
          <h3>Multiplayer Rules</h3>
          <p>
            In multiplayer mode, you win by either obtaining the ZetaMaster code or by being the last human standing.

            Have fun!
          </p>
          <br/>
          <br/>
          Finally, you can check our <a href='/ai-town/privacy.html'><u>Privacy Policy</u></a>.
        </div>
      </ReactModal>
      <div className="p-1 absolute top-0 right-0 z-10 text-2xl">
        <Authenticated>
          <UserButton afterSignOutUrl="/ai-town" />
        </Authenticated>

        <Unauthenticated>
          <LoginButton />
        </Unauthenticated>
      </div>

      <div className="h-[calc(100vh-40px)] w-full relative isolate overflow-hidden pt-10 shadow-2xl flex flex-col justify-center">
        {titleComponent}
        <Game setActiveGame={setActiveGame} />
        {!activeGame && (
          <Lobby setActiveLobby={setActiveLobby} />
        )}

        <footer className="fixed inset-x-0 bottom-0 p-4 z-10">
          {/* Hamburger Menu Toggle */}
          <Button
            className="lg:hidden z-30 absolute left-4 bottom-4"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            imgUrl={burgerImg}
          >
          </Button>

          {/* Menu Content */}
          <div className={`absolute bottom-0 left-4 z-20 ${isMenuOpen ? 'flex' : 'hidden'} lg:hidden flex-col items-start pb-16`}>
            <Button imgUrl={helpImg} onClick={() => setHelpModalOpen(true)}>Help</Button>
            <MusicButton />
            <NewZaraGameButton />
          </div>

          {/* Visible on larger screens */}
          <div className="hidden lg:flex lg:items-end gap-4">
            <Button imgUrl={helpImg} onClick={() => setHelpModalOpen(true)}>Help</Button>
            <MusicButton />
            <NewZaraGameButton />
            {/* ...other buttons */}
          </div>

          {/* Footer Content */}
          <div className="absolute right-0 bottom-0">
            <a href="https://github.com/a16z-infra/ai-town" className="pointer-events-auto">
              Made with AI Town.
            </a>
          </div>
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
    maxWidth: '75%',
    maxHeight: '75%',

    border: '10px solid rgb(23, 20, 33)',
    borderRadius: '0',
    background: 'rgb(35, 38, 58)',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
  },
};