FROM ruby:2.4.0
MAINTAINER Preston Lee

RUN apt-get update && apt-get dist-upgrade -y && apt-get install -y build-essential
RUN gem install bundler && gem update --system

# Configure the main working directory. This is the base
# directory used in any further RUN, COPY, and ENTRYPOINT
# commands.
RUN mkdir -p /app
WORKDIR /app

# Copy the Gemfile as well as the Gemfile.lock and install
# the RubyGems. This is a separate step so the dependencies
# will be cached unless changes to one of those two files
# are made.
COPY Gemfile Gemfile.lock hsp.gemspec Rakefile ./
COPY bin bin
COPY lib lib
RUN bundle install
# RUN rake install

# COPY . .

ENV HSP_AGENT_MARKETPLACE_URL_REST=https://marketplace-server.hspconsortium.org
ENV HSP_AGENT_MARKETPLACE_URL_WS=wss://marketplace-server.hspconsortium.org/websocket
ENV HSP_AGENT_PLATFORM_CLIENT_ID=your_client_id
ENV HSP_AGENT_PLATFORM_CLIENT_SECRET=your_client_secret
# ENV HSP_AGENT_DOCKER_URL=

CMD ['/usr/local/bin/ruby', 'bin/hsp', '--agent', '--platform-id', '--platform-secret', '--rest-url', '--websocket-url']
