import { Component, OnInit, OnDestroy, ViewChild, Inject } from '@angular/core';
import { NgForm, NgModel } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { Actions } from '@ngrx/effects';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';

import { Node } from '../../../shared/models/RTLconfig';
import { PayRequest, Channel, OfferRequest, OfferInvoice } from '../../../shared/models/clnModels';
import { APICallStatusEnum, CLNActions, PaymentTypes, CurrencyUnitEnum, CURRENCY_UNIT_FORMATS, FEE_LIMIT_TYPES, UI_MESSAGES } from '../../../shared/services/consts-enums-functions';
import { DataService } from '../../../shared/services/data.service';
import { CommonService } from '../../../shared/services/common.service';
import { LoggerService } from '../../../shared/services/logger.service';

import { RTLState } from '../../../store/rtl.state';
import { rootSelectedNode } from '../../../store/rtl.selector';
import { fetchOfferInvoice, sendPayment } from '../../store/cln.actions';
import { channels } from '../../store/cln.selector';
import { ApiCallStatusPayload } from '../../../shared/models/apiCallsPayload';
import { CLNPaymentInformation } from '../../../shared/models/alertData';
import { ConvertedCurrency } from '../../../shared/models/rtlModels';

@Component({
  standalone: false,
  selector: 'rtl-cln-lightning-send-payments',
  templateUrl: './send-payment.component.html',
  styleUrls: ['./send-payment.component.scss']
})
export class CLNLightningSendPaymentsComponent implements OnInit, OnDestroy {

  @ViewChild('sendPaymentForm', { static: false }) form: NgForm;
  @ViewChild('paymentAmt', { static: false }) paymentAmt: NgModel;
  @ViewChild('offerAmt', { static: false }) offerAmt: NgModel;

  private paymentReq: NgModel;
  @ViewChild('paymentReq') set payReq(paymReq: NgModel) {
    if (paymReq) {
      this.paymentReq = paymReq;
    }
  }
  private offerReq: NgModel;
  @ViewChild('offerReq') set offrReq(ofrReq: NgModel) {
    if (ofrReq) {
      this.offerReq = ofrReq;
    }
  }
  public faExclamationTriangle = faExclamationTriangle;
  public convertedCurrency: ConvertedCurrency = null;
  public paymentTypes = PaymentTypes;
  public paymentType = PaymentTypes.INVOICE;
  public sideflashAddress = '';
  public sideflashAmount: number | null = null;
  public sideflashFee = 100;
  public sideflashPreview: any = null;
  public sideflashBusy = false;
  private sideflashIntentKey = '';

  public selNode: Node | null;
  public offerDecoded: OfferRequest = {};
  public offerRequest = '';
  public offerDecodedHintPre = '';
  public offerDecodedHintPost = '';
  public offerDescription = '';
  public offerIssuer = '';
  public offerTitle = '';
  public zeroAmtOffer = false;
  public offerInvoice: OfferInvoice | null = null;
  private offerInvoiceRequestedMsat: number | null = null;
  private offerInvoiceRequestedOffer = '';
  // One fetch at a time, and a reply is used only if it answers that fetch's request.
  private offerInvoiceFetchPending = false;
  private offerInvoiceRequest: { offer: string, amount_msat?: number } | null = null;
  public offerAmount: number | null = null;
  public flgSaveToDB = false;

  public paymentDecoded: PayRequest = {};
  public paymentRequest = '';
  public paymentDecodedHintPre = '';
  public paymentDecodedHintPost = '';
  public zeroAmtInvoice = false;
  public paymentAmount = null;

  public pubkey = '';
  public keysendAmount = null;
  public keysendValueHint = '';
  public selActiveChannel: Channel | null = {};
  public activeChannels = {};
  public feeLimit = null;
  public selFeeLimitType = FEE_LIMIT_TYPES[0];
  public feeLimitTypes = FEE_LIMIT_TYPES;
  public paymentError = '';
  private unSubs: Array<Subject<void>> = [new Subject(), new Subject(), new Subject(), new Subject(), new Subject(), new Subject(), new Subject(), new Subject(), new Subject(), new Subject(), new Subject()];

  constructor(
    public dialogRef: MatDialogRef<CLNLightningSendPaymentsComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CLNPaymentInformation,
    private store: Store<RTLState>,
    private logger: LoggerService,
    private commonService: CommonService,
    private decimalPipe: DecimalPipe,
    private actions: Actions,
    private dataService: DataService) { }

  ngOnInit() {
    if (this.data && this.data.paymentType) {
      this.paymentType = this.data.paymentType;
      switch (this.paymentType) {
        case PaymentTypes.INVOICE:
          this.paymentRequest = this.data.invoiceBolt11!;
          break;
        case PaymentTypes.KEYSEND:
          this.pubkey = this.data.pubkeyKeysend!;
          break;
        case PaymentTypes.OFFER:
          this.onPaymentRequestEntry(this.data.bolt12);
          this.offerTitle = this.data.offerTitle!;
          this.flgSaveToDB = false;
          break;
        default:
          break;
      }
    }
    this.store.select(rootSelectedNode).pipe(takeUntil(this.unSubs[0])).subscribe((nodeSettings: Node | null) => {
      this.selNode = nodeSettings;
    });
    this.store.select(channels).pipe(takeUntil(this.unSubs[2])).
      subscribe((channelsSeletor: { activeChannels: Channel[], pendingChannels: Channel[], inactiveChannels: Channel[], apiCallStatus: ApiCallStatusPayload }) => {
        this.activeChannels = channelsSeletor.activeChannels;
        this.logger.info(channelsSeletor);
      });
    this.actions.pipe(
      takeUntil(this.unSubs[3]),
      filter((action) => action.type === CLNActions.UPDATE_API_CALL_STATUS_CLN || action.type === CLNActions.SEND_PAYMENT_STATUS_CLN || action.type === CLNActions.SET_OFFER_INVOICE_CLN)).
      subscribe((action: any) => {
        if (action.type === CLNActions.SEND_PAYMENT_STATUS_CLN) {
          if (this.sideflashIntentKey) { localStorage.removeItem(this.sideflashIntentKey); }
          this.dialogRef.close();
        }
        // The actions stream is app-wide: act only on the reply to this dialog's own pending fetch.
        if (action.type === CLNActions.SET_OFFER_INVOICE_CLN && this.isReplyToPendingFetch(action.payload)) {
          this.offerInvoiceFetchPending = false;
          const issuerAmountMsat = action.payload?.changes?.amount_msat;
          if (this.paymentType !== PaymentTypes.OFFER) {
            // The user left the Offer tab while the invoice was being fetched.
            this.offerInvoice = null;
          } else if (this.offerInvoiceRequestedMsat !== this.getOfferAmountMsat() || this.offerInvoiceRequestedOffer !== this.offerRequest) {
            this.offerInvoice = null;
            this.paymentError = 'The offer or amount changed while the offer invoice was being fetched. Payment not sent, please send again.';
          } else if (issuerAmountMsat !== undefined && issuerAmountMsat !== null && +issuerAmountMsat !== this.getOfferAmountMsat()) {
            this.offerInvoice = null;
            this.paymentError = 'The offer issuer asked for ' + this.decimalPipe.transform(+issuerAmountMsat / 1000, '1.0-3') + ' Sats instead of ' + this.decimalPipe.transform(this.getOfferAmountMsat() / 1000, '1.0-3') + ' Sats. Payment not sent.';
          } else {
            this.offerInvoice = action.payload;
            this.sendPayment();
          }
        }
        if (action.type === CLNActions.UPDATE_API_CALL_STATUS_CLN && action.payload.status === APICallStatusEnum.ERROR) {
          if (action.payload.action === 'FetchOfferInvoice') {
            this.offerInvoiceFetchPending = false;
          }
          if (action.payload.action === 'SendPayment') {
            this.sideflashBusy = false;
            delete this.paymentDecoded.amount_msat;
            this.paymentError = action.payload.message;
          }
          if (action.payload.action === 'DecodePayment') {
            if (this.paymentType === PaymentTypes.INVOICE) {
              this.paymentDecodedHintPre = 'ERROR: ' + action.payload.message;
              this.paymentDecodedHintPost = '';
              this.paymentReq.control.setErrors({ decodeError: true });
            }
            if (this.paymentType === PaymentTypes.OFFER) {
              this.offerDecodedHintPre = 'ERROR: ' + action.payload.message;
              this.offerDecodedHintPost = '';
              this.offerReq.control.setErrors({ decodeError: true });
            }
            if (this.paymentType === PaymentTypes.KEYSEND) {
              this.keysendValueHint = 'ERROR: ' + action.payload.message;
            }
          }
          if (action.payload.action === 'FetchOfferInvoice' && this.paymentType === PaymentTypes.OFFER) {
            this.paymentError = action.payload.message;
          }
        }
      });
  }

  onSendPayment(): boolean | void {
    if (this.paymentType === PaymentTypes.SIDEFLASH) {
      this.sendSideflash();
      return;
    }
    switch (this.paymentType) {
      case PaymentTypes.KEYSEND:
        if (!this.pubkey || this.pubkey.trim() === '' || !this.keysendAmount || this.keysendAmount <= 0) { return true; }
        this.keysendPayment();
        break;

      case PaymentTypes.INVOICE:
        if (!this.paymentRequest || (this.zeroAmtInvoice && (this.paymentAmount === 0 || !this.paymentAmount))) {
          this.paymentReq.control.markAsTouched();
          this.paymentAmt.control.markAsTouched();
          return true;
        }
        if (this.paymentDecoded.created_at) {
          this.sendPayment();
        } else {
          this.resetInvoiceDetails();
          this.dataService.decodePayment(this.paymentRequest, true).
            pipe(takeUntil(this.unSubs[4])).subscribe((decodedPayment: PayRequest | OfferRequest) => {
              if (decodedPayment.type === 'bolt12 offer' && (<OfferRequest>decodedPayment).offer_id) {
                this.paymentDecodedHintPre = 'ERROR: Select Offer option to pay the bolt12 offer invoice.';
                this.paymentDecodedHintPost = '';
                this.paymentReq.control.setErrors({ decodeError: true });
              } else {
                this.paymentDecoded = <PayRequest>decodedPayment;
                this.setPaymentDecodedDetails();
              }
            });
        }
        break;

      case PaymentTypes.OFFER:
        if (!this.offerRequest || (this.zeroAmtOffer && (this.offerAmount === 0 || !this.offerAmount))) {
          this.offerReq.control.markAsTouched();
          this.offerAmt.control.markAsTouched();
          return true;
        }
        if (this.offerDecoded.offer_id) {
          this.sendPayment();
        } else {
          this.resetOfferDetails();
          this.dataService.decodePayment(this.offerRequest, true).
            pipe(takeUntil(this.unSubs[5])).subscribe((decodedOffer: PayRequest | OfferRequest) => {
              if (decodedOffer.type === 'bolt11 invoice' && (<PayRequest>decodedOffer).payment_hash) {
                this.offerDecodedHintPre = 'ERROR: Select Invoice option to pay the bolt11 invoice.';
                this.offerDecodedHintPost = '';
                this.offerReq.control.setErrors({ decodeError: true });
              } else {
                this.offerDecoded = <OfferRequest>decodedOffer;
                this.setOfferDecodedDetails();
              }
            });
        }
        break;

      default:
        break;
    }
  }

  onSideflashChange() {
    this.sideflashPreview = null;
    this.paymentError = '';
  }

  sendSideflash() {
    if (this.sideflashBusy) { return; }
    const address = this.sideflashAddress.trim();
    const amount = Number(this.sideflashAmount),
      fee = Number(this.sideflashFee);
    if (!(/^sfl1/i).test(address) || address.length > 1023 || !Number.isSafeInteger(amount * 1000) || amount <= 0 ||
      !Number.isInteger(amount) || this.sideflashFee === null || !Number.isSafeInteger(fee * 1000) || fee < 0 || !Number.isInteger(fee)) {
      this.paymentError = 'Enter a Sideflash address, a positive whole-sat amount, and a whole-sat maximum routing fee.';
      return;
    }
    this.paymentError = '';
    this.sideflashBusy = true;
    if (!this.sideflashPreview || this.sideflashPreview.address !== address) {
      this.dataService.decodePayment(address, true).pipe(takeUntil(this.unSubs[9])).subscribe({
        next: (decoded: any) => {
          this.sideflashBusy = false;
          if (address !== this.sideflashAddress.trim()) { return; }
          if (decoded.type !== 'sideflash' || decoded.binding_verified !== true || decoded.valid !== true) {
            this.paymentError = 'The connected CLN node did not verify this Sideflash address.';
            return;
          }
          this.sideflashPreview = { ...decoded, address };
        },
        error: (err) => { this.sideflashBusy = false; this.paymentError = err.message; }
      });
      return;
    }
    // Persist before submitting, so a lost HTTP response or reload cannot create a second payment.
    this.sideflashIntentKey = 'rtl-sideflash:' + JSON.stringify([this.selNode.index, address, amount, fee]);
    let label: string;
    try {
      label = localStorage.getItem(this.sideflashIntentKey);
      if (!label) {
        label = 'rtl-' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map((v) => v.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(this.sideflashIntentKey, label);
      }
    } catch (_) {
      this.sideflashBusy = false;
      this.paymentError = 'Browser storage must be available to preserve the payment ID safely.';
      return;
    }
    this.store.dispatch(sendPayment({ payload: { uiMessage: UI_MESSAGES.SEND_PAYMENT, paymentType: PaymentTypes.SIDEFLASH,
      bolt11: address, amount_msat: amount * 1000, maxfee: fee * 1000, label, fromDialog: true } }));
  }

  keysendPayment() {
    if (this.keysendAmount) {
      this.store.dispatch(sendPayment({ payload: { uiMessage: UI_MESSAGES.SEND_KEYSEND, paymentType: PaymentTypes.KEYSEND, destination: this.pubkey, amount_msat: this.keysendAmount * 1000, fromDialog: true } }));
    }
  }

  sendPayment() {
    this.paymentError = '';
    if (this.paymentType === PaymentTypes.INVOICE) {
      if (this.zeroAmtInvoice && this.paymentAmount) {
        this.store.dispatch(sendPayment({ payload: { uiMessage: UI_MESSAGES.SEND_PAYMENT, paymentType: PaymentTypes.INVOICE, bolt11: this.paymentRequest, amount_msat: this.paymentAmount * 1000, fromDialog: true } }));
      } else {
        this.store.dispatch(sendPayment({ payload: { uiMessage: UI_MESSAGES.SEND_PAYMENT, paymentType: PaymentTypes.INVOICE, bolt11: this.paymentRequest, fromDialog: true } }));
      }
    } else if (this.paymentType === PaymentTypes.OFFER) {
      if (!this.offerInvoice) {
        if (this.offerInvoiceFetchPending) {
          this.paymentError = 'Fetching the offer invoice, please wait.';
          return;
        }
        this.offerInvoiceFetchPending = true;
        this.offerInvoiceRequestedMsat = this.getOfferAmountMsat();
        this.offerInvoiceRequestedOffer = this.offerRequest;
        this.offerInvoiceRequest = (this.zeroAmtOffer && this.offerAmount) ? { offer: this.offerRequest, amount_msat: this.offerInvoiceRequestedMsat } : { offer: this.offerRequest };
        this.store.dispatch(fetchOfferInvoice({ payload: this.offerInvoiceRequest }));
      } else {
        if (this.offerAmount) {
          this.store.dispatch(sendPayment({ payload: { uiMessage: UI_MESSAGES.SEND_PAYMENT, paymentType: PaymentTypes.OFFER,
            bolt11: this.offerInvoice.invoice, saveToDB: this.flgSaveToDB, bolt12: this.offerRequest, amount_msat: this.getOfferAmountMsat(),
            zeroAmtOffer: this.zeroAmtOffer, title: this.offerTitle, issuer: this.offerIssuer, description: this.offerDescription,
            fromDialog: true } }));
        }
      }
    }
  }

  isReplyToPendingFetch(reply: OfferInvoice): boolean {
    const pending = this.offerInvoiceRequest;
    return this.offerInvoiceFetchPending && !!pending && !!reply?.request &&
      reply.request.offer === pending.offer && (reply.request.amount_msat ?? null) === (pending.amount_msat ?? null);
  }

  // Whole msat: a fixed offer's own amount (offerAmount is that divided by 1000, which does not
  // always multiply back exactly), or the sats entered for a zero-amount offer.
  getOfferAmountMsat(): number {
    return this.zeroAmtOffer ? Math.round((this.offerAmount || 0) * 1000) : Number(this.offerDecoded.offer_amount_msat || 0);
  }

  onPaymentRequestEntry(event: any) {
    if (this.paymentType === PaymentTypes.INVOICE) {
      this.paymentRequest = event;
      this.resetInvoiceDetails();
    } else if (this.paymentType === PaymentTypes.OFFER) {
      this.offerRequest = event;
      this.resetOfferDetails();
    }
    if (event.length > 100) {
      this.dataService.decodePayment(event, true).pipe(takeUntil(this.unSubs[6])).subscribe((decodedRequest: PayRequest | OfferRequest) => {
        if (this.paymentType === PaymentTypes.INVOICE) {
          if (decodedRequest.type === 'bolt12 offer' && (<OfferRequest>decodedRequest).offer_id) {
            this.paymentDecodedHintPre = 'ERROR: Select Offer option to pay the bolt12 offer invoice.';
            this.paymentDecodedHintPost = '';
            this.paymentReq.control.setErrors({ decodeError: true });
          } else {
            this.paymentDecoded = <PayRequest>decodedRequest;
            this.setPaymentDecodedDetails();
          }
        } else if (this.paymentType === PaymentTypes.OFFER) {
          if (decodedRequest.type === 'bolt11 invoice' && (<PayRequest>decodedRequest).payment_hash) {
            this.offerDecodedHintPre = 'ERROR: Select Invoice option to pay the bolt11 invoice.';
            this.offerDecodedHintPost = '';
            this.offerReq.control.setErrors({ decodeError: true });
          } else {
            this.offerDecoded = <OfferRequest>decodedRequest;
            this.setOfferDecodedDetails();
          }
        }
      });
    }
  }

  resetOfferDetails() {
    this.offerInvoice = null;
    this.offerAmount = null;
    this.offerDecodedHintPre = '';
    this.offerDecodedHintPost = '';
    this.zeroAmtOffer = false;
    this.paymentError = '';
    if (this.offerReq) { this.offerReq.control.setErrors(null); }
  }

  resetInvoiceDetails() {
    this.paymentAmount = null;
    this.paymentDecodedHintPre = '';
    this.paymentDecodedHintPost = '';
    this.zeroAmtInvoice = false;
    this.paymentError = '';
    if (this.paymentReq) { this.paymentReq.control.setErrors(null); }
  }

  onAmountChange(event: any) {
    if (this.paymentType === PaymentTypes.INVOICE) {
      delete this.paymentDecoded.amount_msat;
      this.paymentDecoded.amount_msat = +event.target.value;
    }
    if (this.paymentType === PaymentTypes.OFFER) {
      // An invoice fetched for the previous amount must not be paid for the new one.
      this.offerInvoice = null;
      delete this.offerDecoded.offer_amount_msat;
      this.offerDecoded.offer_amount_msat = event.target.value;
    }
  }

  onPaymentTypeChange() {
    this.paymentError = '';
    this.paymentDecodedHintPre = '';
    this.paymentDecodedHintPost = '';
    this.offerDecodedHintPre = '';
    this.offerDecodedHintPost = '';
    this.offerInvoice = null;
  }

  setOfferDecodedDetails() {
    if (this.offerDecoded.offer_id && !this.offerDecoded.offer_amount_msat) {
      this.offerDecoded.offer_amount_msat = 0;
      this.zeroAmtOffer = true;
      this.offerDescription = this.offerDecoded.offer_description || '';
      this.offerIssuer = this.offerDecoded.offer_issuer ? this.offerDecoded.offer_issuer : '';
      this.offerDecodedHintPre = 'Zero Amount Offer | Description: ' + this.offerDecoded.offer_description;
      this.offerDecodedHintPost = '';
    } else {
      this.zeroAmtOffer = false;
      this.offerAmount = this.offerDecoded.offer_amount_msat ? this.offerDecoded.offer_amount_msat / 1000 : 0;
      this.offerDescription = this.offerDecoded.offer_description || '';
      this.offerIssuer = this.offerDecoded.offer_issuer ? this.offerDecoded.offer_issuer : '';
      if (this.selNode && this.selNode.settings.fiatConversion) {
        this.commonService.convertCurrency(this.offerAmount, CurrencyUnitEnum.SATS, CurrencyUnitEnum.OTHER, (this.selNode.settings.currencyUnits && this.selNode.settings.currencyUnits.length > 2 ? this.selNode.settings.currencyUnits[2] : ''), this.selNode.settings.fiatConversion).
          pipe(takeUntil(this.unSubs[7])).
          subscribe({
            next: (data) => {
              this.convertedCurrency = data;
              this.offerDecodedHintPre = 'Sending: ' + this.decimalPipe.transform(this.offerAmount) + ' Sats (';
              this.offerDecodedHintPost = this.decimalPipe.transform((this.convertedCurrency.OTHER ? this.convertedCurrency.OTHER : 0), CURRENCY_UNIT_FORMATS.OTHER) + ' ' + this.convertedCurrency.unit + ') | Description: ' + this.offerDecoded.offer_description;
            }, error: (error) => {
              this.offerDecodedHintPre = 'Sending: ' + this.decimalPipe.transform(this.offerAmount) + ' Sats | Description: ' + this.offerDecoded.offer_description + '. Unable to convert currency.';
              this.offerDecodedHintPost = '';
            }
          });
      } else {
        this.offerDecodedHintPre = 'Sending: ' + this.decimalPipe.transform(this.offerAmount) + ' Sats | Description: ' + this.offerDecoded.offer_description;
        this.offerDecodedHintPost = '';
      }
    }
  }

  setPaymentDecodedDetails() {
    if (this.paymentDecoded.created_at && !this.paymentDecoded.amount_msat) {
      this.paymentDecoded.amount_msat = 0;
      this.zeroAmtInvoice = true;
      this.paymentDecodedHintPre = 'Zero Amount Invoice | Memo: ' + this.paymentDecoded.description;
      this.paymentDecodedHintPost = '';
    } else {
      this.zeroAmtInvoice = false;
      if (this.selNode && this.selNode.settings.fiatConversion) {
        this.commonService.convertCurrency(this.paymentDecoded.amount_msat ? this.paymentDecoded.amount_msat / 1000 : 0, CurrencyUnitEnum.SATS, CurrencyUnitEnum.OTHER,
          (this.selNode.settings.currencyUnits && this.selNode.settings.currencyUnits.length > 2 ? this.selNode.settings.currencyUnits[2] : ''), this.selNode.settings.fiatConversion).
          pipe(takeUntil(this.unSubs[8])).
          subscribe({
            next: (data) => {
              this.convertedCurrency = data;
              this.paymentDecodedHintPre = 'Sending: ' + this.decimalPipe.transform(this.paymentDecoded.amount_msat ? this.paymentDecoded.amount_msat / 1000 : 0) + ' Sats (';
              this.paymentDecodedHintPost = this.decimalPipe.transform((this.convertedCurrency.OTHER ? this.convertedCurrency.OTHER : 0), CURRENCY_UNIT_FORMATS.OTHER) + ' ' + this.convertedCurrency.unit + ') | Memo: ' + this.paymentDecoded.description;
            }, error: (error) => {
              this.paymentDecodedHintPre = 'Sending: ' + this.decimalPipe.transform(this.paymentDecoded.amount_msat ? this.paymentDecoded.amount_msat / 1000 : 0) + ' Sats | Memo: ' + this.paymentDecoded.description + '. Unable to convert currency.';
              this.paymentDecodedHintPost = '';
            }
          });
      } else {
        this.paymentDecodedHintPre = 'Sending: ' + this.decimalPipe.transform(this.paymentDecoded.amount_msat ? this.paymentDecoded.amount_msat / 1000 : 0) + ' Sats | Memo: ' + this.paymentDecoded.description;
        this.paymentDecodedHintPost = '';
      }
    }
  }

  resetData() {
    if (this.sideflashBusy) { return; }
    this.sideflashAddress = '';
    this.sideflashAmount = null;
    this.sideflashPreview = null;
    switch (this.paymentType) {
      case PaymentTypes.KEYSEND:
        this.pubkey = '';
        this.keysendValueHint = '';
        this.keysendAmount = null;
        break;

      case PaymentTypes.INVOICE:
        this.paymentRequest = '';
        this.paymentDecoded = {};
        this.selActiveChannel = null;
        this.feeLimit = null;
        this.selFeeLimitType = FEE_LIMIT_TYPES[0];
        this.resetInvoiceDetails();
        break;

      case PaymentTypes.OFFER:
        this.offerRequest = '';
        this.offerDecoded = {};
        this.flgSaveToDB = false;
        this.resetOfferDetails();
        break;
      default:
        break;
    }
    this.paymentError = '';
  }

  onKeysendAmountChange() {
    if (this.selNode && this.selNode.settings.fiatConversion) {
      this.keysendValueHint = '';
      if (this.keysendAmount && this.keysendAmount > 99) {
        this.commonService.convertCurrency(this.keysendAmount, CurrencyUnitEnum.SATS, CurrencyUnitEnum.OTHER, (this.selNode.settings.currencyUnits && this.selNode.settings.currencyUnits.length > 2 ? this.selNode.settings.currencyUnits[2] : ''), this.selNode.settings.fiatConversion).
          pipe(takeUntil(this.unSubs[3])).
          subscribe({
            next: (data) => {
              this.convertedCurrency = data;
              this.keysendValueHint = this.decimalPipe.transform(this.convertedCurrency.OTHER, CURRENCY_UNIT_FORMATS.OTHER) + ' ' + this.convertedCurrency.unit;
            }, error: (err) => {
              this.keysendValueHint = 'Conversion Error: ' + err;
            }
          });
      }
    }
  }


  ngOnDestroy() {
    this.unSubs.forEach((completeSub) => {
      completeSub.next(<any>null);
      completeSub.complete();
    });
  }

}
