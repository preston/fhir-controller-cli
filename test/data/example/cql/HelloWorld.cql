library HelloWorld version '1.0.0'

using FHIR version '4.0.1'

include FHIRHelpers version '4.0.1'

context Patient

define HelloWorld:
  'If you\'re seeing this text, the CQL library is working!'

define PatientName:
  First(First(Patient.name).given) + ' ' + First(Patient.name).family


define PatientAge:
  AgeInYears()