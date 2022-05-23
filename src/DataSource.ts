import { EditorQuery, scenarios } from './types';
import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  FieldType,
  MutableDataFrame,
} from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { alertsQueryBuilder, retrieveAlertsData } from './alerts/query';
import { CustomAlertQuery, GenericOptions } from './alerts/types';
import { firstValueFrom } from 'rxjs';

export class AlertmanagerDataSource extends DataSourceApi<EditorQuery, GenericOptions> {
  url: string;
  withCredentials: boolean;
  headers: any;

  constructor(instanceSettings: DataSourceInstanceSettings<GenericOptions>) {
    super(instanceSettings);

    this.url = instanceSettings.url === undefined ? '' : instanceSettings.url;

    this.withCredentials = instanceSettings.withCredentials !== undefined;
    this.headers = { 'Content-Type': 'application/json' };
    if (typeof instanceSettings.basicAuth === 'string' && instanceSettings.basicAuth.length > 0) {
      this.headers['Authorization'] = instanceSettings.basicAuth;
    }
  }

  async query(options: DataQueryRequest<EditorQuery>): Promise<DataQueryResponse> {
    let url: string;
    let params: string[];
    const promises = options.targets.map((query) => {
      if (query.hide) {
        return Promise.resolve(new MutableDataFrame());
      }

      switch (query.scenario) {
        case scenarios.alerts:
          params = alertsQueryBuilder(this, query as CustomAlertQuery, options);
          url = `${this.url}/api/v2/alerts?${params.join('&')}`;
          break;
        default:
          return new Promise(() => null);
      }

      const request = this.doRequest({
        url: url,
        method: 'GET',
      }).then((request: any) => firstValueFrom(request));

      return request.then((data: any) => this.retrieveData(query, data));
    });

    return Promise.all(promises).then((data) => {
      return { data };
    });
  }

  async testDatasource() {
    return this.doRequest({
      url: this.url,
      method: 'GET',
    }).then((response) =>
      firstValueFrom(response).then((data) => {
        if (data !== undefined) {
          if (data.ok) {
            return { status: 'success', message: 'Datasource is working', title: 'Success' };
          } else {
            return {
              status: 'error',
              message: `Datasource is not working: ${data.data}`,
              title: 'Error',
            };
          }
        }
        return {
          status: 'error',
          message: `Unknown error in datasource`,
          title: 'Error',
        };
      })
    );
  }

  async doRequest(options: any) {
    options.withCredentials = this.withCredentials;
    options.headers = this.headers;
    return getBackendSrv().fetch(options);
  }

  buildDataFrame(refId: string, data: any): MutableDataFrame {
    const fields = [
      { name: 'Time', type: FieldType.time },
      { name: 'SeverityValue', type: FieldType.number },
    ];

    if (data.length > 0) {
      const annotations: string[] = data.map((alert: any) => Object.keys(alert.annotations)).flat();
      const labels: string[] = data.map((alert: any) => Object.keys(alert.labels)).flat();
      const alertstatus: string[] = ['alertstatus', 'alertstatus_code'];
      const attributes: string[] = [...new Set([...annotations, ...labels, ...alertstatus])];

      attributes.forEach((attribute: string) => {
        fields.push({
          name: attribute,
          type: FieldType.string,
        });
      });
    }

    const frame = new MutableDataFrame({
      refId: refId,
      fields: fields,
    });
    return frame;
  }

  parseAlertAttributes(alert: any, fields: any[]): string[] {
    let severityValue = 4;
    switch (alert.labels['severity']) {
      case 'critical':
        severityValue = 1;
        break;
      case 'warning':
        severityValue = 2;
        break;
      case 'info':
        severityValue = 3;
        break;
      default:
        break;
    }

    const row: string[] = [alert.startsAt, severityValue];
    fields.slice(2).forEach((element: any) => {
      row.push(alert.annotations[element.name] || alert.labels[element.name] || '');
    });
    return row;
  }

  retrieveData(query: any, data: any): Promise<MutableDataFrame> {
    switch (query.scenario) {
      case scenarios.alerts:
        return retrieveAlertsData(query, data);

      default:
        return new Promise(() => null);
    }
  }

  interpolateQueryExpr(value: string | string[] = [], variable: any) {
    // if no multi or include all do not regexEscape
    if (!variable.multi && !variable.includeAll) {
      return alertmanagerRegularEscape(value);
    }

    if (typeof value === 'string') {
      return alertmanagerSpecialRegexEscape(value);
    }

    const escapedValues = value.map((val) => alertmanagerSpecialRegexEscape(val));

    if (escapedValues.length === 1) {
      return escapedValues[0];
    }

    return '(' + escapedValues.join('|') + ')';
  }
}

export function alertmanagerRegularEscape(value: any) {
  return typeof value === 'string' ? value.replace(/\\/g, '\\\\').replace(/'/g, "\\\\'") : value;
}

export function alertmanagerSpecialRegexEscape(value: any) {
  return typeof value === 'string' ? value.replace(/\\/g, '\\\\\\\\').replace(/[$^*{}\[\]\'+?()|]/g, '\\\\$&') : value;
}
