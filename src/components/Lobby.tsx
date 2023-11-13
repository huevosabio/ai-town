import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import Button from './buttons/Button.tsx';
import interactImg from '../../assets/interact.svg';

export default function Lobby() {
  const partyData = useQuery(api.zaraInit.getParty);
  const startGame = useMutation(api.zaraInit.multiplayerInit);
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
          <Button imgUrl={interactImg} onClick={sharePartyLink}>Share Game Link</Button>
        </div>
      )}
    </div>
  );
}