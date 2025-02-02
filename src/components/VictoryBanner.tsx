import React, {useEffect, useState} from 'react';
import { Doc } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api.js';
import {sound} from '@pixi/sound';

interface VictoryBannerProps {
  gameStatus: Doc<'worldStatus'>;
}

const VictoryBanner: React.FC<VictoryBannerProps> = ({ gameStatus }) => {
  const userId = useQuery(api.zaraInit.getUserId) ?? null;
  const userStatus = gameStatus.userStatus?.find((s) => s.userId === userId)?.status;

  const [soundAdded, setSoundAdded] = useState(false);

  useEffect(() => {
    // add sound for report notifications
    sound.add('victory', '/ai-town/assets/sounds/success.wav');
    sound.add('defeat', '/ai-town/assets/sounds/spooky_snap.wav');
    setSoundAdded(true);
  }, []);

  let gameOverBanner = null;
  let subtext = null;
  if (soundAdded) {
    if (gameStatus.isSoloGame) {
      if (gameStatus.status === 'stoppedByHumanVictory') {
        gameOverBanner = 'Human wins!';
        subtext = 'You got the code!';
        sound.play('victory');
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
        case 'lost-left': 
          gameOverBanner = 'You lost!';
          subtext = 'You left the game due to idleness';
          sound.play('defeat');
          break;
        case 'lost-other-won': 
          gameOverBanner = 'You lost!';
          subtext = 'The other player got the code!';
          sound.play('defeat');
          break;
        case 'won-code':
          gameOverBanner = 'You won!';
          subtext = 'You got the code!';
          sound.play('victory');
          break;
        case 'won-last-human': 
          gameOverBanner = 'You won!';
          subtext = 'You are the last human remaining!';
          sound.play('victory');
          break;
        case 'playing':
          return null;
        default:
          return null;
      }
    }
  }

  return (
    <div style={victoryBannerStyles} className="mx-auto text-center text-6xl sm:text-8xl lg:text-9xl font-bold font-display leading-none tracking-wide game-title">
      <h1>{gameOverBanner}</h1>
      <p className="mx-auto my-4 text-center text-xl sm:text-2xl text-white leading-tight">{subtext}</p>
    </div>
    
  );
};

export default VictoryBanner;

const victoryBannerStyles: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '0',
  width: '100%',
  transform: 'translateY(-50%)',
  opacity: '0.95',
  zIndex: 1
}