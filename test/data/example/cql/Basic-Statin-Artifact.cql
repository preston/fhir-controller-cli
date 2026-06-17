library "Basic-Statin-Artifact" version '0.0.1'

using FHIR version '4.0.1'

include "FHIRHelpers" version '4.0.1' called FHIRHelpers

codesystem "LOINC": 'http://loinc.org'
codesystem "CONDCLINSTATUS": 'http://terminology.hl7.org/CodeSystem/condition-clinical'
codesystem "CONDVERSTATUS": 'http://terminology.hl7.org/CodeSystem/condition-ver-status'

valueset "Diabetes VS": 'https://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.103.12.1001'
valueset "Moderate Intensity Statin Therapy VS": 'https://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1047.98'

code "79423-0 code": '79423-0' from "LOINC" display 'Cardiovascular disease 10Y risk [Likelihood] ACC-AHA Pooled Cohort by Goff 2013'
code "Condition Active code": 'active' from "CONDCLINSTATUS" display 'Active'
code "Condition Confirmed code": 'confirmed' from "CONDVERSTATUS" display 'Confirmed'

concept "Condition Active": { "Condition Active code" } display 'Active'
concept "Condition Confirmed": { "Condition Confirmed code" } display 'Confirmed'

context Patient

define "AgeRange-3aba0be3-4ead-4217-8eb7-7aedec686fe0":
  AgeInYears() >= 40
    and AgeInYears() <= 72

define "Diabetes":
  exists ( Confirmed(ActiveCondition([Condition: "Diabetes VS"])) )

define "CVD 10-yr Risk >= 10 %":
  QuantityValue(MostRecent(Verified(ObservationLookBack([Observation: "79423-0 code"], 6 years)))) >= 10 '%'

define "On Statin Therapy":
  exists ( ActiveMedicationRequest([MedicationRequest: "Moderate Intensity Statin Therapy VS"]) )

define "MeetsInclusionCriteria":
  "AgeRange-3aba0be3-4ead-4217-8eb7-7aedec686fe0"
    and "Diabetes"
    and "CVD 10-yr Risk >= 10 %"

define "MeetsExclusionCriteria":
  "On Statin Therapy"

define "InPopulation":
  "MeetsInclusionCriteria"
    and not "MeetsExclusionCriteria"

define "Recommendation":
  if "InPopulation" then 'Start low to moderate intensity statin' 
    else null

define "Rationale":
  if "InPopulation" then null 
    else null

define "Links":
  if "InPopulation" then null 
    else null

define "Suggestions":
  if "InPopulation" then null 
    else null

define "Errors":
  null

define function Verified(ObsList List<Observation>):
  ObsList O
    where O.status.value in { 'final', 'corrected', 'amended' }

define function ObservationLookBack(ObsList List<Observation>, LookBack System.Quantity):
  ObsList O
    let LookBackInterval: Interval[Now() - LookBack, Now()]
    where ( O.effective as FHIR.dateTime ).value in LookBackInterval
      or ( O.effective as FHIR.instant ).value in LookBackInterval
      or PeriodToInterval(O.effective as FHIR.Period) overlaps LookBackInterval
      or O.issued.value in LookBackInterval

define function MostRecent(ObsList List<Observation>):
  Last(ObsList O
      sort by Coalesce((effective as FHIR.dateTime).value,(effective as FHIR.instant).value,(effective as FHIR.Period)."end".value,(effective as FHIR.Period)."start".value, issued.value)
  )

define function QuantityValue(Obs Observation):
  FHIRHelpers.ToQuantity ( Obs.value as FHIR.Quantity )

define function Confirmed(CondList List<Condition>):
  CondList C
    where C.verificationStatus ~ "Condition Confirmed"

define function ActiveCondition(CondList List<Condition>):
  CondList C
    where C.clinicalStatus ~ "Condition Active"
      and C.abatement is null

define function ActiveMedicationRequest(MedList List<MedicationRequest>):
  MedList M
    where M.status.value = 'active'

define function PeriodToInterval(period FHIR.Period):
  if period is null then null 
    else Interval[period."start".value, period."end".value]