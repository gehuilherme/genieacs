.. _environment-variables:

Environment Variables
=====================

Configuring GenieACS services can be done through the following environment
variables:

.. attention::

  All GenieACS environment variables must be prefixed with ``GENIEACS_``.

MONGODB_CONNECTION_URL
  MongoDB connection string.

  Default: ``mongodb://127.0.0.1/genieacs``

EXT_DIR
  The directory from which to look up extension scripts.

  Default: ``<installation dir>/config/ext``

EXT_TIMEOUT
  Timeout (in milliseconds) to allow for calls to extensions to return a
  response.

  Default: ``3000``

DEBUG_FILE
  File to dump CPE debug log.

  Default: unset

DEBUG_FORMAT
  Debug log format. Valid values are 'yaml' and 'json'.

  Default: ``yaml``

LOG_FORMAT
  The format used for the log entries in ``CWMP_LOG_FILE``, ``NBI_LOG_FILE``,
  ``FS_LOG_FILE``, and ``UI_LOG_FILE``. Possible values are ``simple`` and
  ``json``.

  Default: ``simple``

ACCESS_LOG_FORMAT
  The format used for the log entries in ``CWMP_ACCESS_LOG_FILE``,
  ``NBI_ACCESS_LOG_FILE``, ``FS_ACCESS_LOG_FILE``, and ``UI_ACCESS_LOG_FILE``.
  Possible values are ``simple`` and ``json``.

  Default: ``simple``

CWMP_WORKER_PROCESSES
  The number of worker processes to spawn for genieacs-cwmp. A value of 0 means
  as many as there are CPU cores available.

  Default: ``0``

CWMP_PORT
  The TCP port that genieacs-cwmp listens on.

  Default: ``7547``

CWMP_INTERFACE
  The network interface that genieacs-cwmp binds to.

  Default: ``::``

CWMP_SSL_CERT
  Path to certificate file. If omitted, non-secure HTTP will be used.

  Default: unset

CWMP_SSL_KEY
  Path to certificate key file. If omitted, non-secure HTTP will be used.

  Default: unset

CWMP_LOG_FILE
  File to log process related events for genieacs-cwmp. If omitted, logs will
  go to stderr.

  Default: unset

CWMP_ACCESS_LOG_FILE
  File to log incoming requests for genieacs-cwmp. If omitted, logs will go to
  stdout.

  Default: unset

NBI_WORKER_PROCESSES
  The number of worker processes to spawn for genieacs-nbi. A value of 0 means
  as many as there are CPU cores available.

  Default: ``0``

NBI_PORT
  The TCP port that genieacs-nbi listens on.

  Default: ``7557``

NBI_INTERFACE
  The network interface that genieacs-nbi binds to.

  Default: ``::``

NBI_SSL_CERT
  Path to certificate file. If omitted, non-secure HTTP will be used.

  Default: unset

NBI_SSL_KEY
  Path to certificate key file. If omitted, non-secure HTTP will be used.

  Default: unset

NBI_LOG_FILE
  File to log process related events for genieacs-nbi. If omitted, logs will go
  to stderr.

  Default: unset

NBI_ACCESS_LOG_FILE
  File to log incoming requests for genieacs-nbi. If omitted, logs will go to
  stdout.

  Default: unset

FS_WORKER_PROCESSES
  The number of worker processes to spawn for genieacs-fs. A value of 0 means
  as many as there are CPU cores available.

  Default: ``0``

FS_PORT
  The TCP port that genieacs-fs listens on.

  Default: ``7567``

FS_INTERFACE
  The network interface that genieacs-fs binds to.

  Default: ``::``

FS_SSL_CERT
  Path to certificate file. If omitted, non-secure HTTP will be used.

  Default: unset

FS_SSL_KEY
  Path to certificate key file. If omitted, non-secure HTTP will be used.

  Default: unset

FS_LOG_FILE
  File to log process related events for genieacs-fs. If omitted, logs will go
  to stderr.

  Default: unset

FS_ACCESS_LOG_FILE
  File to log incoming requests for genieacs-fs. If omitted, logs will go to
  stdout.

  Default: unset

FS_URL_PREFIX
  The URL prefix (e.g. 'https://example.com:7567/') to use when generating the
  file URL for TR-069 Download requests. Set this if genieacs-fs and
  genieacs-cwmp are behind a proxy or running on different servers.

  Default: auto generated based on the hostname from the ACS URL, FS_PORT
  config, and whether or not SSL is enabled for genieacs-fs.

UI_WORKER_PROCESSES
  The number of worker processes to spawn for genieacs-ui. A value of 0 means
  as many as there are CPU cores available.

  Default: ``0``

UI_PORT
  The TCP port that genieacs-ui listens on.

  Default: ``3000``

UI_INTERFACE
  The network interface that genieacs-ui binds to.

  Default: ``::``

UI_SSL_CERT
  Path to certificate file. If omitted, non-secure HTTP will be used.

  Default: unset

UI_SSL_KEY
  Path to certificate key file. If omitted, non-secure HTTP will be used.

  Default: unset

UI_LOG_FILE
  File to log process related events for genieacs-ui. If omitted, logs will go
  to stderr.

  Default: unset

UI_ACCESS_LOG_FILE
  File to log incoming requests for genieacs-ui. If omitted, logs will go to
  stdout.

  Default: unset

UI_JWT_SECRET
  The key used for signing JWT tokens that are stored in browser cookies. The
  string can be up to 64 characters in length.

  Default: unset

TR-369 (USP) bus
----------------

The following variables configure the NATS JetStream bus that connects the
USP controller and MTP services. See :doc:`usp/configuration` for the full
USP configuration surface.

GENIEACS_NATS_URL
  Connection URL of the NATS server. Comma-separated list for a cluster.

  Default: ``nats://127.0.0.1:4222``

GENIEACS_NATS_USER
  Username for NATS authentication. Leave unset if the server allows
  anonymous connections.

  Default: unset

GENIEACS_NATS_PASSWORD
  Password for NATS authentication.

  Default: unset

GENIEACS_NATS_STREAM_NAME
  Name of the JetStream stream used for the ``from-mtp.>`` and ``to-mtp.>``
  subjects. The controller creates the stream on first start if it does
  not exist.

  Default: ``GENIEACS_USP``

TR-369 (USP) MQTT MTP
---------------------

The following variables configure ``genieacs-usp-mqtt``, the MQTT v5 client
that bridges an external broker to the USP controller. See
:doc:`usp/mtp/mqtt` for the full discussion.

GENIEACS_USP_MQTT_URL
  Connection URL of the MQTT broker. Use ``mqtt://`` for plain TCP or
  ``mqtts://`` for TLS.

  Default: ``mqtt://127.0.0.1:1883``

GENIEACS_USP_MQTT_CLIENT_ID
  MQTT client identifier. A per-worker suffix is appended automatically
  when running with multiple workers.

  Default: ``genieacs-usp-mqtt``

GENIEACS_USP_MQTT_USERNAME
  Username for broker authentication.

  Default: unset

GENIEACS_USP_MQTT_PASSWORD
  Password for broker authentication.

  Default: unset

GENIEACS_USP_MQTT_TOPIC_PREFIX
  Common prefix for the controller topic (``<prefix>/controller``) and
  the per-agent topics (``<prefix>/agent/<endpointId>``).

  Default: ``genieacs/usp/v1``

GENIEACS_USP_MQTT_KEEPALIVE
  MQTT keepalive interval, in seconds.

  Default: ``60``

GENIEACS_USP_MQTT_RECONNECT_PERIOD
  Delay between reconnect attempts when the broker connection drops,
  in milliseconds.

  Default: ``5000``

GENIEACS_USP_MQTT_WORKER_PROCESSES
  Number of worker processes to fork in ``genieacs-usp-mqtt``. ``0`` means
  one per CPU core.

  Default: ``0``

GENIEACS_USP_MQTT_TLS_CA
  Path to a PEM-encoded CA certificate (or bundle) used to verify the
  broker's certificate.

  Default: unset

GENIEACS_USP_MQTT_TLS_CERT
  Path to a PEM-encoded client certificate for mutual TLS.

  Default: unset

GENIEACS_USP_MQTT_TLS_KEY
  Path to the PEM-encoded private key matching ``GENIEACS_USP_MQTT_TLS_CERT``.

  Default: unset

GENIEACS_USP_MQTT_TLS_REJECT_UNAUTHORIZED
  Reject the broker's certificate when it cannot be verified against the
  trust store. Set to ``false`` only for development against self-signed
  brokers.

  Default: ``true``
