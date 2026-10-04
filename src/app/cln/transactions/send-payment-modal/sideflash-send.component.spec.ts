import { of, Subject } from 'rxjs';
import { CLNLightningSendPaymentsComponent } from './send-payment.component';
import { PaymentTypes } from '../../../shared/services/consts-enums-functions';

describe('Sideflash send confirmation', () => {
  let component: CLNLightningSendPaymentsComponent;
  let store: any;
  let service: any;
  const address = 'sfl1test-address-for-ui';
  beforeEach(() => {
    store = { dispatch: jasmine.createSpy('dispatch') };
    service = { decodePayment: jasmine.createSpy('decode').and.returnValue(of({ type: 'sideflash', valid: true, binding_verified: true })) };
    component = new CLNLightningSendPaymentsComponent({} as any, {} as any, store, {} as any, {} as any, {} as any, {} as any, service);
    component.selNode = { index: 777 } as any;
    component.paymentType = PaymentTypes.SIDEFLASH;
    component.sideflashAddress = address;
    component.sideflashAmount = 10000;
    component.sideflashFee = 100;
  });
  afterEach(() => {
    Object.keys(localStorage).filter((key) => key.startsWith('rtl-sideflash:[777,')).forEach((key) => localStorage.removeItem(key));
    component.ngOnDestroy();
  });
  it('requires verification, then sends exact amount and capped fee; a retry retains the ID', () => {
    component.sendSideflash();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(component.sideflashPreview.address).toBe(address);
    component.sendSideflash();
    const first = store.dispatch.calls.mostRecent().args[0].payload;
    expect(first.amount_msat).toBe(10000000);
    expect(first.maxfee).toBe(100000);
    component.sendSideflash();
    expect(store.dispatch.calls.count()).toBe(1);
    component.sideflashBusy = false; // Lost HTTP response permits retry, never a new ID.
    component.sendSideflash();
    expect(store.dispatch.calls.mostRecent().args[0].payload.label).toBe(first.label);
  });
  it('ignores a verification response for an edited address', () => {
    const response = new Subject<any>();
    service.decodePayment.and.returnValue(response);
    component.sendSideflash();
    component.sideflashAddress = 'sfl1different';
    component.onSideflashChange();
    response.next({ type: 'sideflash', valid: true, binding_verified: true });
    expect(component.sideflashPreview).toBeNull();
    expect(store.dispatch).not.toHaveBeenCalled();
  });
  it('rejects invalid amount and fee without querying or sending', () => {
    component.sideflashAmount = 1.5;
    component.sendSideflash();
    component.sideflashAmount = 10000;
    component.sideflashFee = -1;
    component.sendSideflash();
    expect(service.decodePayment).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
