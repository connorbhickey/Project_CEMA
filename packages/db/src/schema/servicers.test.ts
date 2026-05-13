import { describe, expect, it } from 'vitest';

import { servicerCemaDepartments, servicers } from './servicers';

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
        'notes',
        'lastVerifiedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('cema departments table joins to servicer with full contact + escalation columns', () => {
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
        'escalationPath',
        'commonRejectionReasons',
        'createdAt',
        'updatedAt',
      ]),
    );
  });
});
