import type { PetId } from '../../shared/types'
import type { BubbleTheme } from '../ui/bubble'

/** What makes each pet itself: what it says, a few extra habits, and its speech-bubble colours. */
export interface Persona {
  /** Said now and then when hungry / starving (Catbot: no contributions today). */
  hungryLines: string[]
  starvingLines: string[]
  /** Occasional remarks when fed, by level 1..4. */
  fedLines: string[][]
  /** Said when flicked hard. */
  thrownLines: string[]
  /** Said while crawling to tap on a window. */
  tapLines: string[]
  /** Extra things to do when content, added to the shared activity weights. */
  extraWeights: [string, number][]
  /** Washes its paws after eating (raccoons do). */
  washAfterEat: boolean
  /** An animation to play when it nags you about something (Syncy's tail slap, Mole's digging). */
  alertAnim?: 'slap' | 'rummage' | 'bark'
  bubble: BubbleTheme
}

const CATBOT: Persona = {
  hungryLines: [
    'NO CONTRIBUTIONS TODAY... FEED ME COMMITS',
    'LOW BATTERY... FEED ME COMMITS',
    '*WHIRRR* SO HUNGRY...',
    '*SIGH*',
    'EVEN A TYPO FIX WOULD DO.',
    'GIT COMMIT -M "FOOD"?',
    'ERROR 404: SNACK NOT FOUND'
  ],
  starvingLines: ['...', 'B-BATTERY CRITICAL...', 'TWO DAYS WITHOUT COMMITS...', 'C-COMMIT... PLEASE...'],
  fedLines: [
    [],
    ['SNACKED. COULD EAT MORE COMMITS.', 'WARMING UP MY CIRCUITS...', 'A FEW MORE COMMITS?'],
    ['NICE AND STEADY TODAY.', 'PURR... COMMITS ARE GOOD.', 'TASTY CONTRIBUTIONS!'],
    ['FULL BATTERY!', 'BIG DAY! ZOOMIES TIME!', 'YOUR GRAPH IS GLOWING GREEN!'],
    ['LEGENDARY DAY!', 'MAXIMUM GREEN ACHIEVED!', 'I AM POWERED BY YOUR COMMITS!']
  ],
  thrownLines: ['WHEEE!', 'SYSTEM SHAKEN!', 'HEY!'],
  tapLines: ['FOOD...?', '*TAP TAP*', 'ANYONE CODING?'],
  extraWeights: [],
  washAfterEat: false,
  bubble: { accent: '#F28A1E' }
}

const DUSTY: Persona = {
  hungryLines: ['NOTHING TO EAT AROUND HERE...'],
  starvingLines: ['...'],
  fedLines: [
    [],
    ['SNIFF SNIFF...', 'ANY CRUMBS LEFT?'],
    ['SMELLS LIKE STALE CACHE IN HERE.', 'I COULD GO FOR SOME TEMP FILES.', 'TRASH PANDA ON PATROL.'],
    ['YOUR DISK IS LOOKING TIDY.', 'NICE AND CLEAN. FOR NOW.', 'NOTHING WASTED, NOTHING STALE.'],
    ['SPARKLING! I DID THAT.', 'BURP. GREAT MEAL.', 'CLEAN DISK, HAPPY RACCOON.']
  ],
  thrownLines: ['HEY! I WAS WORKING!', 'MY BANDANA!', 'WHOA!'],
  tapLines: ['*SCRATCH SCRATCH*', 'ANYTHING IN THERE?'],
  extraWeights: [
    ['wash', 8],
    ['rummage', 10]
  ],
  washAfterEat: true,
  bubble: { accent: '#1FB5A3' }
}

const SYNCY: Persona = {
  hungryLines: ['SO MUCH WORK NOT ON GITHUB...', 'MY DAM IS LEAKING! PUSH YOUR COMMITS.', 'ONE LAPTOP SPILL AND IT IS GONE...'],
  starvingLines: ['...'],
  fedLines: [
    [],
    ['THAT WORK HAS BEEN SITTING A WHILE...', 'GIT PUSH. PLEASE?'],
    ['SOME WORK STILL NEEDS PUSHING.', 'DON’T FORGET TO PUSH TODAY.', 'COMMIT SMALL, PUSH OFTEN.'],
    ['FRESH WORK IN PROGRESS. NICE!', 'GNAWING ON YOUR GIT LOG.', 'PUSH WHEN YOU ARE READY.'],
    ['EVERYTHING IS ON GITHUB. SAFE!', 'NOTHING LEAKS PAST THIS DAM.', 'ALL SYNCED. TIME FOR A SNACK.']
  ],
  thrownLines: ['WHOA! MY HARD HAT!', 'HEY, I WAS BUILDING!', 'SPLASH!'],
  tapLines: ['*TAP TAP* PUSH IT?', 'KNOCK KNOCK. GIT PUSH?'],
  extraWeights: [
    ['rummage', 9],
    ['wash', 5]
  ],
  washAfterEat: true,
  alertAnim: 'slap',
  bubble: { accent: '#E2A812' }
}

const MOLE: Persona = {
  hungryLines: ['NO WORMS IN THESE TUNNELS...'],
  starvingLines: ['...'],
  fedLines: [
    [],
    ['TWO SERVERS, ONE PORT. THIS ENDS BADLY.', 'SOMEONE IS SITTING ON YOUR PORT.'],
    ['SOME SERVERS ARE STILL RUNNING WITH NO TERMINAL.', 'FORGOT A SERVER? I DID NOT.'],
    ['SNIFFING AROUND LOCALHOST.', 'YOUR SERVERS ARE HUMMING.', 'I KNOW WHO HAS PORT 3000.'],
    ['ALL TUNNELS CLEAR.', 'NO PORT FIGHTS TODAY.', 'EVERY PORT IS FREE FOR YOU.']
  ],
  thrownLines: ['MY GLASSES!', 'HEY! I WAS DIGGING!', 'TOO BRIGHT UP HERE!'],
  tapLines: ['*SCRATCH SCRATCH*', 'ANY PORTS IN THERE?'],
  extraWeights: [
    ['rummage', 10],
    ['wash', 5]
  ],
  washAfterEat: true,
  alertAnim: 'rummage',
  bubble: { accent: '#D9577F' }
}

const REX: Persona = {
  hungryLines: ['NOTHING TO SNIFF...'],
  starvingLines: ['...'],
  fedLines: [
    [],
    ['GRRR... A SECRET IS OUT ON GITHUB.', 'ROTATE THAT KEY, HUMAN!'],
    ['SOMETHING SMELLS FUNNY ON GITHUB.', 'SNIFF... A DATABASE PASSWORD?'],
    ['SNIFF SNIFF...', 'GUARDING YOUR REPOS.', 'ON PATROL.'],
    ['NO LEAKS. GOOD HUMAN.', 'ALL YOUR REPOS SMELL CLEAN.', 'WOOF! NOTHING TO REPORT.']
  ],
  thrownLines: ['ARF!', 'MY SERVOS!', 'WHEEE! WOOF!'],
  tapLines: ['*SCRATCH SCRATCH*', 'WOOF? ANYONE?'],
  extraWeights: [
    ['rummage', 10],
    ['wash', 4]
  ],
  washAfterEat: false,
  alertAnim: 'bark',
  bubble: { accent: '#3D7BF2' }
}

export const PERSONAS: Record<PetId, Persona> = { catbot: CATBOT, dusty: DUSTY, syncy: SYNCY, mole: MOLE, rex: REX }
