import { useQuery, useMutation } from 'convex/react';
import { useState, useEffect } from 'react';
import { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import Button from './buttons/Button.tsx';
import interactImg from '../../assets/interact.svg';

export default function Lobby() {
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
    return null;
  }

  const sharePartyLink = () => {
    const url = window.location.origin + '/?partyId=' + partyData.id;
    navigator.clipboard.writeText(url);
    console.log(url);
    //alert('Party link copied to clipboard!');
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <div>
        <h1>Lobby</h1>
        <ul>
          {partyData.users.map((user) => (
            <li key={user.username}>
              {user.username} {user.isHost && '(Host)'}
            </li>
          ))}
        </ul>
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
  );
}