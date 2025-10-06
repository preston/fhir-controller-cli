// Author: Preston Lee

export interface RxNormConcept {
  RXCUI: string;
  LAT: string;
  TS: string;
  LUI: string;
  STT: string;
  SUI: string;
  ISPREF: string;
  RXAUI: string;
  SAUI: string;
  SCUI: string;
  SDUI: string;
  SAB: string;
  TTY: string;
  CODE: string;
  STR: string;
  SRL: string;
  SUPPRESS: string;
  CVF: string;
}

export interface RxNormConceptData {
  concept: RxNormConcept;
  synonyms: string[];
  relationships: string[];
}
