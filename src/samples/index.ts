import highPnr from './high-pnr.yaml?raw';
import elevator from './elevator.yaml?raw';
import floppy from './floppy.yaml?raw';
import spain from './spain-pnr.yaml?raw';
import horns from './horns.yaml?raw';
import backdoor from './backdoor.yaml?raw';
import dho from './dho.yaml?raw';
import alleyOop from './alley-oop.yaml?raw';

/** Built-in sample play library (spec §49). */
export const SAMPLE_PLAYS: { id: string; name: string; yaml: string }[] = [
  { id: 'high-pnr', name: '01 High Pick & Roll', yaml: highPnr },
  { id: 'elevator', name: '02 Elevator Doors', yaml: elevator },
  { id: 'floppy', name: '03 Floppy', yaml: floppy },
  { id: 'spain-pnr', name: '04 Spain Pick & Roll', yaml: spain },
  { id: 'horns', name: '05 Horns', yaml: horns },
  { id: 'backdoor', name: '06 Backdoor Cut', yaml: backdoor },
  { id: 'dho', name: '07 Dribble Handoff', yaml: dho },
  { id: 'alley-oop', name: '08 Alley-Oop', yaml: alleyOop },
];
