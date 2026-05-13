import { describe, expect, it } from 'vitest';

import { servicerCemaDepartments, servicers } from './servicers.js';

describe('servicers schema', () => {
  it('servicers table has playbook columns', () => {
    const cols = Object.keys(servicers);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'legalName',
        'dbaNames',
        'nmlsId',
        'mersOrgId',
        'parentServicerId',
        'collateralCustodian',
        'playbookVersion',
        'lastVerifiedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('cema departments table joins to servicer', () => {
    const cols = Object.keys(servicerCemaDepartments);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'servicerId',
        'phone',
        'fax',
        'email',
        'portalUrl',
        'acceptedSubmissionMethods',
        'typicalSlaBusinessDays',
        'createdAt',
        'updatedAt',
      ]),
    );
  });
});
