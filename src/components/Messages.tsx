import clsx from 'clsx';
import { Doc, Id } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { MessageInput } from './MessageInput';
import { Player } from '../../convex/aiTown/player';
import { Conversation } from '../../convex/aiTown/conversation';

export function Messages({
  worldId,
  engineId,
  conversation,
  inConversationWithMe,
  selectedPlayer,
  humanPlayer,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  conversation:
    | { kind: 'active'; doc: Conversation }
    | { kind: 'archived'; doc: Doc<'archivedConversations'> };
  inConversationWithMe: boolean;
  selectedPlayer: Player;
  humanPlayer?: Player;
}) {
  const humanPlayerId = humanPlayer?.id;
  const descriptions = useQuery(api.world.gameDescriptions, { worldId });
  let participantIds;
  if (conversation.kind === 'active') {
    participantIds = [...conversation.doc.participants.keys()];
  } else {
    participantIds = conversation.doc.participants;
  } 
  const humanIsParticipant = participantIds.includes(humanPlayerId!);
  const messages = useQuery(api.messages.listMessages, {
    worldId,
    conversationId: conversation.doc.id,
    eavesdropperId: !humanIsParticipant ? humanPlayerId : undefined,
  });
  let currentlyTyping = conversation.kind === 'active' ? conversation.doc.isTyping : undefined;
  if (messages !== undefined && currentlyTyping) {
    if (messages.find((m) => m.messageUuid === currentlyTyping!.messageUuid)) {
      currentlyTyping = undefined;
    }
  }
  const currentlyTypingName =
    currentlyTyping &&
    descriptions?.playerDescriptions.find((p) => p.playerId === currentlyTyping?.playerId)?.name;

  if (messages === undefined) {
    return null;
  }
  if (messages.length === 0 && !inConversationWithMe) {
    return null;
  }
  const messageNodes: { time: number; node: React.ReactNode }[] = messages.map((m) => {
    const isHumanPlayerMessage = m.author === humanPlayerId;
    const isSelectedPlayerMessage = m.author === selectedPlayer.id;
    const node = (
      <div key={`text-${m._id}`} className="leading-tight mb-6">
        <div className={clsx('bubble', (isHumanPlayerMessage || !isSelectedPlayerMessage) && 'bubble-mine')}>
        <p className={clsx('-mx-3 -my-1', (isHumanPlayerMessage || !isSelectedPlayerMessage) ? 'bg-white' : 'bg-slate-300')}>{m.text}</p>
        </div>
      </div>
    );
    return { node, time: m._creationTime };
  });
  const lastMessageTs = messages.map((m) => m._creationTime).reduce((a, b) => Math.max(a, b), 0);

  const membershipNodes: typeof messageNodes = [];
  if (conversation.kind === 'active') {
    for (const [playerId, m] of conversation.doc.participants) {
      const playerName = descriptions?.playerDescriptions.find((p) => p.playerId === playerId)
        ?.name;
      let started;
      if (m.status.kind === 'participating') {
        started = m.status.started;
      }
      if (playerId !== selectedPlayer.id && !humanIsParticipant && started) {
        membershipNodes.push({
          node: (
            <div key={`joined-${playerId}`} className="leading-tight mb-6">
              <p className="text-brown-700 text-center">In conversation with {playerName}.</p>
            </div>
          ),
          time: started,
        });
      }
    }
  } else {
    for (const playerId of conversation.doc.participants) {
      const playerName = descriptions?.playerDescriptions.find((p) => p.playerId === playerId)
        ?.name;
      const started = conversation.doc.created;
      membershipNodes.push({
        node: (
          <div key={`joined-${playerId}`} className="leading-tight mb-6">
            <p className="text-brown-700 text-center">{playerName} joined the conversation.</p>
          </div>
        ),
        time: started,
      });
      const ended = conversation.doc.ended;
      membershipNodes.push({
        node: (
          <div key={`left-${playerId}`} className="leading-tight mb-6">
            <p className="text-brown-700 text-center">{playerName} left the conversation.</p>
          </div>
        ),
        // Always sort all "left" messages after the last message.
        // TODO: We can remove this once we want to support more than two participants per conversation.
        time: Math.max(lastMessageTs + 1, ended),
      });
    }
  }
  const nodes = [...messageNodes, ...membershipNodes];
  nodes.sort((a, b) => a.time - b.time);
  return (
    <div className="chats text-base sm:text-sm overflow-y-scroll flex-initial">
      <div className="bg-brown-200 text-black p-2">
        {nodes.length > 0 && nodes.map((n) => n.node)}
        {currentlyTyping && currentlyTyping.playerId !== humanPlayerId && (
          <div key="typing" className="leading-tight mb-6">
            <div className={clsx('bubble')}>
              <p className="bg-slate-300 -mx-3 -my-1">
                <i>typing...</i>
              </p>
            </div>
          </div>
        )}
        {humanPlayer && inConversationWithMe && conversation.kind === 'active' && (
          <MessageInput
            worldId={worldId}
            engineId={engineId}
            conversation={conversation.doc}
            humanPlayer={humanPlayer}
          />
        )}
      </div>
    </div>
  );
}
