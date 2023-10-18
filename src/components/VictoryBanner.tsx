import React from 'react';

interface VictoryBannerProps {
  gameStatus: string;
}

const VictoryBanner: React.FC<VictoryBannerProps> = ({ gameStatus }) => {
  let gameOverBanner = null;
  let subtext = null;
  if (gameStatus === 'stoppedByHumanVictory') {
    gameOverBanner = 'Human wins!';
    subtext = 'You got the code!';
  } else if (gameStatus === 'stoppedByHumanCaught') {
    gameOverBanner = 'AI wins!';
    subtext = 'You were caught!';
  } else {
    return null;
  }

  return (
    <div className="mx-auto text-center text-6xl sm:text-8xl lg:text-9xl font-bold font-display leading-none tracking-wide game-title">
      <h1>{gameOverBanner}</h1>
      <p className="mx-auto my-4 text-center text-xl sm:text-2xl text-white leading-tight">{subtext}</p>
    </div>
    
  );
};

export default VictoryBanner;