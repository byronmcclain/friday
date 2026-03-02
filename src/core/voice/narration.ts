/**
 * Fisher-Yates shuffle-then-cycle phrase picker.
 * Guarantees no consecutive repeats across cycle boundaries.
 */
export class NarrationPicker {
  private readonly source: readonly string[];
  private shuffled: string[] = [];
  private index = 0;
  private lastPicked: string | null = null;

  constructor(source: readonly string[]) {
    this.source = source;
    this.reshuffle();
  }

  next(): string {
    if (this.source.length === 0) return "";
    if (this.source.length === 1) return this.source[0]!;

    if (this.index >= this.shuffled.length) {
      this.reshuffle();
      if (this.shuffled[0] === this.lastPicked) {
        const swapIdx = 1 + Math.floor(Math.random() * (this.shuffled.length - 1));
        [this.shuffled[0], this.shuffled[swapIdx]] = [this.shuffled[swapIdx]!, this.shuffled[0]!];
      }
    }

    const picked = this.shuffled[this.index]!;
    this.index++;
    this.lastPicked = picked;
    return picked;
  }

  private reshuffle(): void {
    this.shuffled = [...this.source];
    for (let i = this.shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffled[i], this.shuffled[j]] = [this.shuffled[j]!, this.shuffled[i]!];
    }
    this.index = 0;
  }
}

export const ACK_PHRASES: readonly string[] = [
  "On it, boss.",
  "Consider it done.",
  "Let me pull that up.",
  "Right away.",
  "I'm on the case.",
  "Leave it with me.",
  "Checking now.",
  "One moment.",
  "Working on that.",
  "Let me take a look.",
  "I'll sort that out.",
  "Give me a second.",
  "Straight away.",
  "On the case.",
  "Let me see what I can do.",
  "I'll handle it.",
  "Absolutely.",
  "Right so.",
  "Let me dig into that.",
  "Coming right up.",
  "I'll get right on it.",
  "Noted — looking into it.",
  "Already on it.",
  "Let me run that down.",
  "Say no more.",
  "Grand — I'll check that.",
  "One sec, boss.",
  "I'm all over it.",
  "Let me have a look.",
  "I'll see what we've got.",
];

export const TOOL_NARRATIONS: Record<string, readonly string[]> = {
  "git.status": [
    "Taking a peek at the repo...",
    "Let me see what's changed around here...",
    "Checking the repo state...",
    "Running a quick status check...",
  ],
  "git.diff": [
    "Pulling up the diff — let's see what's changed...",
    "Reviewing the diff now...",
    "Looking at what's different since last commit...",
  ],
  "git.log": [
    "Digging through the commit history...",
    "Let me trace back through the timeline...",
    "Checking the logs — always good to know where we've been...",
  ],
  "git.branch": [
    "Checking the branches...",
    "Let me see what branches are in play...",
    "Looking at the branch layout...",
  ],
  "git.stash": [
    "Checking the stash...",
    "Let me see what's tucked away...",
    "Looking at stashed changes...",
  ],
  "git.push": [
    "Pushing that up now...",
    "Sending changes upstream...",
    "Pushing to the remote...",
  ],
  "git.pull": [
    "Pulling in the latest...",
    "Let me grab the upstream changes...",
    "Syncing with remote...",
  ],
  "docker.ps": [
    "Checking what's running in the containers...",
    "Let me see what Docker's got going on...",
    "Peeking under the hood at the containers...",
  ],
  "docker.logs": [
    "Reading the container logs — let's see what's been happening...",
    "Pulling up those logs now...",
    "Checking what the container's been up to...",
  ],
  "docker.inspect": [
    "Inspecting the container details...",
    "Let me get a closer look at that container...",
    "Pulling up the full container spec...",
  ],
  "docker.stats": [
    "Checking container resource usage...",
    "Let me pull up the stats...",
    "Looking at how the containers are performing...",
  ],
  "docker.exec": [
    "Running a command inside the container...",
    "Executing in the container now...",
    "Hopping into the container to run that...",
  ],
  "fs.read": [
    "Reading that file now...",
    "Let me take a look at that...",
    "Pulling up the file...",
    "Opening that up...",
  ],
  "fs.write": [
    "Writing that out now...",
    "Saving changes...",
    "Putting that down on disk...",
  ],
  "fs.list": [
    "Listing the directory contents...",
    "Let me see what's in there...",
    "Browsing the file system...",
  ],
  "fs.delete": [
    "Removing that file...",
    "Deleting now...",
    "Taking care of that removal...",
  ],
  "bash.exec": [
    "Running that command now...",
    "Executing — fingers crossed...",
    "Let me fire that off...",
    "On it — running the command...",
  ],
  "recall_memory": [
    "Let me check my memory on that...",
    "Searching through past conversations...",
    "I think I remember something about this — let me look...",
    "Digging through the archives...",
  ],
  "web.fetch": [
    "Fetching that from the web...",
    "Let me grab that...",
    "Reaching out to the internet...",
  ],
  "getEnvironmentStatus": [
    "Running a systems scan...",
    "Checking the vitals...",
    "Let me see how everything's running...",
  ],
  "manage_rhythm": [
    "Adjusting the scheduler...",
    "Updating the rhythm...",
    "Tweaking the schedule...",
  ],
  "gmail.search": [
    "Searching through the inbox...",
    "Let me dig through the emails...",
    "Looking for that in the mail...",
  ],
  "gmail.read": [
    "Opening up that email...",
    "Let me read that...",
    "Pulling up the message...",
  ],
  "gmail.send": [
    "Sending that off now...",
    "Firing off the email...",
    "Message away...",
  ],
  "gmail.reply": [
    "Drafting the reply...",
    "Sending that reply now...",
    "Replying to the thread...",
  ],
  "gmail.modify": [
    "Updating the email labels...",
    "Modifying that message...",
    "Making those changes to the email...",
  ],
};

export const GENERIC_NARRATIONS: readonly string[] = [
  "Working on something here, one moment...",
  "Processing that...",
  "Crunching through this — bear with me...",
  "Hold that thought, I'm on it...",
  "Just need a moment on this one...",
];

/** Get a tool-specific narration, or fall back to generic. */
export function getToolNarration(toolName: string, toolPickers: Map<string, NarrationPicker>, genericPicker: NarrationPicker): string {
  const phrases = TOOL_NARRATIONS[toolName];
  if (phrases) {
    if (!toolPickers.has(toolName)) {
      toolPickers.set(toolName, new NarrationPicker(phrases));
    }
    return toolPickers.get(toolName)!.next();
  }
  return genericPicker.next();
}
