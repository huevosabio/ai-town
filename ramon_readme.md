## This is Ramon's log

- [2023-10-15 22:13:00] fixed that, and it works! for tomorrow, I need to add the victory conditions and show some sort of pop up:
  - human has the code, human wins
  - all ai have the code, ai wins (actually, this is not a good idea because you could win by reporting whomever, so perhaps only reported human?)
  - human has been found and reported
- [2023-10-15 20:12:28] now I have to fix the human interaction since it broke when I added the new fields
- [2023-10-15 20:10:21] Fantastic! So i had a bug where i was never passing the share code function, but now it works, zaranova shared it with maxfusion but reported leosky
- [2023-10-15 20:02:41] actually, zaranova gave him the code, why did not call the function? I may need to have a call back ... sigh
- [2023-10-15 20:00:54] interestingly, maxfusion outright asked for the code, and zaranova behaved as if she did not have it? prompting is going to be a bitch
- [2023-10-15 19:48:33] ok, so now we have the report and share functionality, although we have not seen any code sharing, now we need to propagate the repercussions (i.e. if you are reported you should be expelled)
- [2023-10-15 14:06:04] Resuming the work, I don't know if I want to make the code sharing an explicit function call or if it should implicit. I think it should be an explicit choice by the LLM. Roughly, always offer the option of sharing the code / or report human (if the AI has the code). That way the AI knows the implications.
- [2023-10-12 10:36:21] Adding the table that has the state for the zetamaster [done]
- [2023-10-12 10:29:12] Going to work on the path for being able to declare someone as human, which requires an AI to have the code. So first, let's build the following features:
  - Keep track of which players have the zetamaster [done]
  - Keep track of which players have been declared as human [done]
  - Offer the LLM the "functions" to share code / report as human. [done]
  - Allow action to declare a player human if you have the code [done]
  - Callback to action that stores that in the system [done]
  - End game if human player is reported