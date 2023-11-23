import { useQuery, useMutation } from 'convex/react';
import { useState, useEffect } from 'react';
import { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { toastOnError } from '../toasts';
import Button from './buttons/Button.tsx';
import interactImg from '../../assets/interact.svg';
import RetroTable from './RetroTable.tsx';
import { toast } from 'react-toastify';
import { useConvexAuth } from "convex/react";

export default function Lobby({setActiveLobby}: {setActiveLobby: (active: boolean) => void}) {
  const startGame = useMutation(api.zaraInit.multiplayerInit);
  const joinParty = useMutation(api.zaraInit.joinParty);
  const leaveParty = useMutation(api.zaraInit.leaveParty);
  
  const [partyId, setPartyId] = useState<string>();
  const { isLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (isAuthenticated) {
      const parseParams = async () => {
        const params = new URLSearchParams(window.location.search);
        console.log(params);
        console.log(window.location);
        console.log(params);
        const partyId = params.get('partyId');
        if (partyId){
          setPartyId(partyId);
        }
      };
      void parseParams();
    }
  }, [isAuthenticated]);

  const joinPartyWithToast = async (partyId: string) => {
    await toastOnError(joinParty({partyId: partyId as Id<'parties'>}));
  }

  useEffect(() => {
    if (partyId && isAuthenticated) {
      console.log('Joining party ' + partyId);
      joinPartyWithToast(partyId);
      // delete search params if exist
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      console.log('No party id');
    }
  }, [partyId, isAuthenticated]);


  const partyData = useQuery(api.zaraInit.getParty, {partyId: partyId as Id<'parties'>});

  if (!partyData) {
    setActiveLobby(false);
    return null;
  } else {
    setActiveLobby(true);
  }


  const sharePartyLink = () => {
    const url = window.location.origin + '/?partyId=' + partyData.id;
    navigator.clipboard.writeText(url);
    console.log(url);
    //alert('Party link copied to clipboard!');
  }

  const leavePartyButton = () => {
    leaveParty({partyId: partyData.id});
    setActiveLobby(false);
    setPartyId(undefined);
  }

  const tableData = {
    columns: [
      { header: 'Username', field: 'username' },
      { header: 'Status', field: 'status' },
    ],
    rows: partyData.users.map((user) => ({
      username: user.username ?? 'Anonymous',
      status: user.isHost ? 'Host' : 'Joined',
    })),
  };

  return (
    <div className={`
      mx-auto w-full h-full mt-1 sm:mt-1 grid 
      lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto]
      max-h-full max-w-screen game-frame
      grid-rows-[1fr_0px]
    `}>
      {/* The lobby */}
      <div className={`
          flex flex-col shrink-0 px-4
          py-6 sm:px-6 lg:w-96 xl:pr-6 border-t-8
          sm:border-t-0 sm:border-l-8 border-brown-900 
          bg-brown-800 text-brown-100
          h-full
          overflow-y-scroll
          `}>
                  <div className="flex gap-4">
        <div className="box w-full mr-auto">
          <h2 className="bg-brown-700 p-2 font-display text-lg lg:text-xl tracking-wider shadow-solid text-center">
            Lobby
          </h2>
        </div>
      </div>
      {partyData.isHost && partyData.users.length > 1 && (
          <a
          className='mt-6 button text-white shadow-solid text-base lg:text-lg cursor-pointer pointer-events-auto'
          onClick={() => startGame({partyId: partyData.id})}
        >
          <h2 className="h-full bg-clay-700 text-center">
            <span>Start</span>
          </h2>
        </a>
      )}
      {!partyData.joined && (
          <a
          className='mt-6 button text-white shadow-solid text-base lg:text-lg cursor-pointer pointer-events-auto'
          onClick={() => joinParty({partyId: partyData.id})}
        >
          <h2 className="h-full bg-clay-700 text-center">
            <span>Join Game</span>
          </h2>
        </a>
      )}
      <a
        className='mt-6 button text-white shadow-solid text-base lg:text-lg cursor-pointer pointer-events-auto'
        onClick={sharePartyLink}
      >
        <h2 className="h-full bg-clay-700 text-center">
          <span>Share Game Link</span>
        </h2>
      </a>
        <div className="box mt-6">
          <h2 className="bg-brown-700 text-sm lg:text-base text-center">
            Players
          </h2>
          <div className="chats text-base text-lg overflow-y-scroll flex-initial">
            <div className="bg-brown-200 text-black p-2">
              {partyData.users.map((user, index) => (
                <p key={index}>
                  {user.username ?? 'Anonymous'} {user.isHost ? '(Host)' : ''}
                </p>
              ))}
            </div>
          </div>
        </div>
        {/* leave button*/}
        <a
          className='mt-6 button text-white shadow-solid text-base lg:text-lg cursor-pointer pointer-events-auto'
          onClick={leavePartyButton}
        >
          <h2 className="h-full bg-clay-700 text-center">
            <span>Leave</span>
          </h2>
        </a>
      </div>
      {/* The multiplayer instructions */}
      <div className="multiplayer-help hidden lg:block font-body text-xs sm:text-sm md:text-md">
          <h1 className="text-center text-xl sm:text-2xl md:text-4xl font-bold font-display game-title">Help</h1>
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
          <h2 className="text-xl sm:text-lg mt-4">Game rules</h2>
          <br/>
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
          </p>
            <ul className="list-disc list-inside">
              <li>You obtain the ZetaMaster code (human victory).</li>
              <li>You are reported as a human (AI victory).</li>
            </ul>
          <p>
            AIs wrongly reported as humans will be destroyed.
          </p>
        </div>
    </div>
  );
}