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
  bubble: {}
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
  bubble: {
    header: '#2fb5a5',
    headerShade: '#1f8a7d',
    headerText: '#05211d',
    cable: '#2fb5a5',
    text: '#9cf7d8'
  }
}

export const PERSONAS: Record<PetId, Persona> = { catbot: CATBOT, dusty: DUSTY }
