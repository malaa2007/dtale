import _ from "lodash";
import moment from "moment";
import PropTypes from "prop-types";
import React from "react";
import { connect } from "react-redux";

import { Bouncer } from "../Bouncer";
import ConditionalRender from "../ConditionalRender";
import { RemovableError } from "../RemovableError";
import { closeChart } from "../actions/charts";
import { buildURL } from "../actions/url-utils";
import chartUtils from "../chartUtils";
import { fetchJson } from "../fetcher";
import { toggleBouncer } from "../toggleUtils";
import ChartsBody from "./charts/ChartsBody";
import CorrelationScatterStats from "./correlations/CorrelationScatterStats";
import CorrelationsGrid from "./correlations/CorrelationsGrid";
import CorrelationsTsOptions from "./correlations/CorrelationsTsOptions";
import corrUtils from "./correlations/correlationsUtils";

const BASE_SCATTER_URL = "/dtale/scatter";
const BASE_CORRELATIONS_URL = "/dtale/correlations";
const BASE_CORRELATIONS_TS_URL = "/dtale/correlations-ts";

function buildState() {
  return {
    chart: null,
    error: null,
    scatterError: null,
    correlations: null,
    selectedCols: [],
    tsUrl: null,
    selectedDate: null,
    tsType: "date",
    scatterUrl: null,
    rolling: false,
    window: 4,
  };
}

class ReactCorrelations extends React.Component {
  constructor(props) {
    super(props);
    this.state = buildState();
    _.forEach(["buildTs", "buildScatter", "viewScatter", "viewScatterRow"], f => (this[f] = this[f].bind(this)));
  }

  shouldComponentUpdate(newProps, newState) {
    if (!_.isEqual(this.props, newProps)) {
      return true;
    }
    const stateProps = ["error", "scatterError", "stats", "correlations", "selectedCols", "selectedDate", "window"];
    if (!_.isEqual(_.pick(this.state, stateProps), _.pick(newState, stateProps))) {
      return true;
    }
    if (this.state.chart != newState.chart) {
      // Don't re-render if we've only changed the chart.
      return false;
    }
    return false; // Otherwise, use the default react behaviour.
  }

  componentDidMount() {
    fetchJson(buildURL(`${BASE_CORRELATIONS_URL}/${this.props.dataId}`, this.props.chartData, ["query"]), gridData => {
      if (gridData.error) {
        this.setState({ error: <RemovableError {...gridData} /> });
        return;
      }
      const { data, dates, rolling } = gridData;
      const state = {
        correlations: data,
        dates,
        hasDate: _.size(dates) > 0,
        selectedDate: _.get(dates, 0, null),
        rolling,
      };
      this.setState(state, () => {
        const { col1, col2 } = this.props.chartData || {};
        if (col1 && col2) {
          if (state.hasDate) {
            if (rolling) {
              this.buildTs([col1, col2], state.selectedDate, 4);
            } else {
              this.buildTs([col1, col2], state.selectedDate);
            }
          } else {
            this.buildScatter([col1, col2]);
          }
        }
      });
    });
  }

  buildTs(selectedCols, selectedDate, rollingWindow = null) {
    const query = _.get(this.props, "chartData.query");
    const path = `${BASE_CORRELATIONS_TS_URL}/${this.props.dataId}`;
    const tsUrl = buildURL(path, { query, selectedCols, dateCol: selectedDate, rollingWindow }, [
      "query",
      "selectedCols",
      "dateCol",
      "rollingWindow",
    ]);
    const updatedState = { selectedCols, selectedDate, tsUrl };
    if (this.state.rolling && !_.isNull(rollingWindow)) {
      updatedState.window = rollingWindow;
    }
    this.setState(updatedState);
  }

  viewScatterRow(evt) {
    const point = this.state.chart.getElementAtEvent(evt);
    if (point) {
      const data = point[0]._chart.config.data.datasets[point[0]._datasetIndex].data;
      const index = data[point[0]._index].index;
      this.props.onClose();
      let updatedQuery = this.props.chartData.query;
      if (updatedQuery) {
        updatedQuery = [updatedQuery, `index == ${index}`];
      } else {
        updatedQuery = [`index == ${index}`];
      }
      this.props.propagateState({ query: _.join(updatedQuery, " and ") });
    }
  }

  buildScatter(selectedCols, date = null) {
    const params = { selectedCols, query: this.props.chartData.query };
    if (date) {
      params.dateCol = this.state.selectedDate;
      params.date = date;
    }
    if (this.state.rolling) {
      params.rolling = this.state.rolling;
      params.window = this.state.window;
    }
    const path = `${BASE_SCATTER_URL}/${this.props.dataId}`;
    const scatterUrl = buildURL(path, params, ["selectedCols", "query", "date", "dateCol", "rolling", "window"]);
    if (this.state.scatterUrl === scatterUrl) {
      return;
    }
    toggleBouncer(["scatter-bouncer", "rawScatterChart"]);
    fetchJson(scatterUrl, fetchedChartData => {
      toggleBouncer(["scatter-bouncer", "rawScatterChart"]);
      const newState = {
        selectedCols,
        stats: fetchedChartData.stats,
        date,
        scatterError: null,
        scatterUrl,
      };
      if (fetchedChartData.error) {
        newState.scatterError = <RemovableError {...fetchedChartData} />;
      }
      const builder = ctx => {
        if (!_.get(fetchedChartData, "data.all.x", []).length) {
          return null;
        }
        const { x, y } = fetchedChartData;
        return corrUtils.createScatter(ctx, fetchedChartData, x, y, this.viewScatterRow);
      };
      newState.chart = chartUtils.chartWrapper("rawScatterChart", this.state.chart, builder);
      this.setState(newState);
    });
  }

  viewScatter(evt) {
    const chart = _.get(this, "_ts_chart.state.charts.0");
    if (chart) {
      const selectedPoint = _.head(chart.getElementsAtXAxis(evt));
      if (selectedPoint) {
        const date = moment(new Date(chart.data.labels[selectedPoint._index])).format("YYYYMMDD");
        const { selectedCols } = this.state;
        this.buildScatter(selectedCols, date);
      }
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div key="body" className="modal-body scatter-body">
          {this.state.error}
        </div>
      );
    }
    const { selectedCols, tsUrl, hasDate } = this.state;
    return (
      <div key="body" className="modal-body scatter-body">
        <CorrelationsGrid
          buildTs={this.buildTs}
          buildScatter={this.buildScatter}
          col1={_.get(this.props, "chartData.col1")}
          col2={_.get(this.props, "chartData.col2")}
          {...this.state}
        />
        <ConditionalRender display={!_.isEmpty(selectedCols) && hasDate}>
          <CorrelationsTsOptions {...this.state} buildTs={this.buildTs} />
          <ChartsBody
            ref={r => (this._ts_chart = r)}
            visible={true}
            url={tsUrl}
            columns={[
              { name: "x", dtype: "datetime[ns]" },
              { name: "corr", dtype: "float64" },
            ]}
            x={{ value: "x" }}
            y={[{ value: "corr" }]}
            configHandler={config => {
              config.options.scales.yAxes = [
                {
                  ticks: { min: -1.1, max: 1.1, stepSize: 0.2 },
                  afterTickToLabelConversion: data => {
                    data.ticks[0] = null;
                    data.ticks[data.ticks.length - 1] = null;
                  },
                  id: "y-corr",
                },
              ];
              config.options.onClick = this.viewScatter;
              config.options.legend = { display: false };
              config.plugins = [chartUtils.gradientLinePlugin(corrUtils.colorScale, "y-corr", -1, 1)];
              return config;
            }}
            height={300}
            showControls={false}
          />
        </ConditionalRender>
        <CorrelationScatterStats {...this.state} />
        <figure>
          {this.state.scatterError}
          <ConditionalRender display={_.isEmpty(this.state.scatterError)}>
            <div className="chart-wrapper" style={{ height: 400 }}>
              <div id="scatter-bouncer" style={{ display: "none" }}>
                <Bouncer />
              </div>
              <canvas id="rawScatterChart" />
            </div>
          </ConditionalRender>
        </figure>
      </div>
    );
  }
}
ReactCorrelations.displayName = "Correlations";
ReactCorrelations.propTypes = {
  dataId: PropTypes.string.isRequired,
  chartData: PropTypes.shape({
    visible: PropTypes.bool.isRequired,
    query: PropTypes.string,
    title: PropTypes.string,
    col1: PropTypes.string,
    col2: PropTypes.string,
  }),
  onClose: PropTypes.func,
  propagateState: PropTypes.func,
};

const ReduxCorrelations = connect(
  state => _.pick(state, ["dataId", "chartData"]),
  dispatch => ({ onClose: () => dispatch(closeChart()) })
)(ReactCorrelations);

export { ReactCorrelations, ReduxCorrelations as Correlations };
