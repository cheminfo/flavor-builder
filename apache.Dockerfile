FROM httpd:2-alpine

# my-httpd.conf was created by first getting the default httpd.conf:
# $ docker run --rm httpd:2-alpine cat /usr/local/apache2/conf/httpd.conf > configs/httpd.conf
# Then, it was modified to allow for SSI
# `LoadModule include_module`: Loads the SSI module.
# `Options ... Includes`: Enables SSI in the specified directory.
# `AddType` and `AddOutputFilter`: Ensures .html files are parsed for SSI.

COPY ./configs/httpd.conf /usr/local/apache2/conf/httpd.conf