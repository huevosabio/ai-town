import { useQuery, useMutation } from 'convex/react';
import { useState, useEffect } from 'react';
import { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import Button from './buttons/Button.tsx';
import interactImg from '../../assets/interact.svg';
import RetroTable from './RetroTable.tsx';

export default function Lobby({setActiveLobby}: {setActiveLobby: (active: boolean) => void}) {
  const startGame = useMutation(api.zaraInit.multiplayerInit);
  const joinParty = useMutation(api.zaraInit.joinParty);
  
  const [partyId, setPartyId] = useState<string>();
  useEffect(() => {
    const parseParams = async () => {
      const params = new URLSearchParams(window.location.search);
      console.log(window.location);
      console.log(params);
      const partyId = params.get('partyId');
      if (partyId){
        setPartyId(partyId);
      }
    };
    void parseParams();
  }, []);

  const partyData = useQuery(api.zaraInit.getParty, {partyId: partyId as Id<'parties'>});

  if (partyId) {
    console.log('Joining party ' + partyId);
    joinParty({partyId: partyId as Id<'parties'>});
  }
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
    <div className="mx-auto w-full max-w mt-2 sm:mt-7 grid grid-rows-[240px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:h-[700px] max-w-[1400px] min-h-[480px] game-frame">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1>Lobby</h1>
          <RetroTable {...tableData} />
        </div>
        {partyData.isHost && (
          <div>
            <Button imgUrl={interactImg} onClick={() => startGame({partyId: partyData.id})}>Start Game</Button>
          </div>
        )}
        {!partyData.joined && (
          <div>
            <Button imgUrl={interactImg} onClick={() => startGame({partyId: partyData.id})}>Join Party</Button>
          </div>
        )}
        <div>
          <Button imgUrl={interactImg} onClick={sharePartyLink}>Share Game Link</Button>
        </div>
      </div>
    </div>
  );
}