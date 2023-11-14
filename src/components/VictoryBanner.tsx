import React from 'react';
import { Doc } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api.js';

interface VictoryBannerProps {
  gameStatus: Doc<'worldStatus'>;
}

const VictoryBanner: React.FC<VictoryBannerProps> = ({ gameStatus }) => {
  const userId = useQuery(api.zaraInit.getUserId) ?? null;
  const userStatus = gameStatus.userStatus?.find((s) => s.userId === userId)?.status;
  console.log('userStatus', userStatus);
  let gameOverBanner = null;
  let subtext = null;
  console.log(gameStatus.isSoloGame, gameStatus.status);
  if (gameStatus.isSoloGame) {
    if (gameStatus.status === 'stoppedByHumanVictory') {
      gameOverBanner = 'Human wins!';
      subtext = 'You got the code!';
    } else if (gameStatus.status === 'stoppedByHumanCaught') {
      gameOverBanner = 'AI wins!';
      subtext = 'You were caught!';
    } else {
      return null;
    }
  } else {
    switch (userStatus) {
      case 'lost-reported': 
        gameOverBanner = 'You lost!';
        subtext = 'You were caught!';
        break;
      case 'lost-other-won': 
        gameOverBanner = 'You lost!';
        subtext = 'The other player got the code!';
        break;
      case 'won-code':
        gameOverBanner = 'You won!';
        subtext = 'You got the code!';
        break;
      case 'won-last-human': 
        gameOverBanner = 'You won!';
        subtext = 'You are the last human remaining!';
        break;
      case 'playing':
        return null;
      default:
        return null;
    }
  }

  return (
    <div className="mx-auto text-center text-6xl sm:text-8xl lg:text-9xl font-bold font-display leading-none tracking-wide game-title">
      <h1>{gameOverBanner}</h1>
      <p className="mx-auto my-4 text-center text-xl sm:text-2xl text-white leading-tight">{subtext}</p>
    </div>
    
  );
};

export default VictoryBanner;